// Auto Job Solver — job type solver functions (9 types + dispatcher).

import { humanDelay } from '../shared/ws-utils.js';
import { ensureDecryptSolverEnabled, ensureIceWallSolverEnabled, ensureSimpleDecryptSolverEnabled } from '../shared/hack-utils.js';
import { friendlyError } from '../shared/error-map.js';
import { state, sendCmd, delay, waitForEvent, log, waitForHackToBeDone } from './state.js';
import { jobLabel, extractFileInfoFromConditions, jobConditionsRequireDecrypt, checkDecryptPowerViaAnalysis, ensureDecryptOnlyLoadout, tryLoadoutSwapForError, waitForMinigameOrError, throwMinigameLockError } from './helpers.js';
import { stepTakeJob, stepCompleteJob, stepSetEndpoint, stepLogin, stepDiscoverDownloadFolder } from './steps.js';

// ---- Shared decrypt flow helper ----
// Used by File Decryption, Data Download, and Decrypt & Extract
// Handles: equip loadout, analysis check, decrypt.file, minigame/error race, retries
async function runDecryptFlow(fileId, fileName, job) {
    // Equip decrypt-only loadout, then check power
    await ensureDecryptOnlyLoadout(job);
    await delay(humanDelay());

    var powerCheck = await checkDecryptPowerViaAnalysis(fileId, job);
    if (!powerCheck.ok && powerCheck.required > 0) {
        log('Decrypt power still insufficient after loadout swap — attempting loadout upgrade');
        var swapOk = await tryLoadoutSwapForError('insufficient_power', job, powerCheck);
        if (!swapOk) {
            throw new Error('Insufficient decrypt power — no loadout can meet requirement');
        }
        await delay(humanDelay());
    }

    ensureDecryptSolverEnabled();
    ensureIceWallSolverEnabled();
    ensureSimpleDecryptSolverEnabled();
    log('Opening file for decryption: ' + fileName);
    sendCmd('decrypt.file', { fileId: fileId });

    var openResult = await waitForMinigameOrError(12000);

    if (openResult.locked) {
        throwMinigameLockError(openResult.locked);
    }

    var isAlreadyDecrypted = false;
    if (openResult.error) {
        var errMsg = openResult.error.message || openResult.error.kind || JSON.stringify(openResult.error);
        var isLoadoutError = errMsg.indexOf('missing-software') >= 0 || errMsg.indexOf('insufficient_power') >= 0 ||
            errMsg.indexOf('insufficient-power') >= 0 || errMsg.indexOf('File is encrypted') >= 0;
        isAlreadyDecrypted = errMsg.indexOf('cannot-read-sai-file') >= 0 || errMsg.indexOf('Cannot read SAI file') >= 0 || errMsg.indexOf('file-already-decrypted') >= 0;

        if (isAlreadyDecrypted) {
            log('File already decrypted — attempting job completion directly', 'success');
        } else if (isLoadoutError) {
            log('Loadout: file open failed (' + errMsg + ') — attempting software swap');
            var swapOk2 = await tryLoadoutSwapForError(errMsg, job, openResult.error);
            if (swapOk2) {
                log('Loadout: swap successful — retrying file open');
                await delay(1000);
                ensureDecryptSolverEnabled();
                ensureIceWallSolverEnabled();
                ensureSimpleDecryptSolverEnabled();
                sendCmd('decrypt.file', { fileId: fileId });
                var retryResult = await waitForMinigameOrError(12000);
                if (retryResult.locked) throwMinigameLockError(retryResult.locked);
                if (retryResult.error) {
                    var retryErrMsg = retryResult.error.message || retryResult.error.kind || JSON.stringify(retryResult.error);
                    throw new Error(friendlyError(retryErrMsg));
                } else if (retryResult.timeout) {
                    log('Minigame start not detected on retry', 'warn');
                }
            } else {
                throw new Error(friendlyError(errMsg));
            }
        } else {
            throw new Error(friendlyError(errMsg));
        }
    } else if (openResult.timeout) {
        log('Minigame start not detected (solver may handle it directly)', 'warn');
    }

    if (!isAlreadyDecrypted) {
        await waitForHackToBeDone();
    }

    // Retry loop for job completion after decrypt
    await delay(1500);
    var decryptRetries = 0;
    var MAX_DECRYPT_RETRIES = 6;
    while (true) {
        try {
            var reward = await stepCompleteJob(job);
            if (reward) return reward;
            if (decryptRetries >= MAX_DECRYPT_RETRIES) {
                log('No reward after decrypt — max retries reached', 'warn');
                return null;
            }
        } catch (e) {
            if (e.message && e.message.indexOf('job-not-found') >= 0) {
                log('Job ID is stale — job list outdated, requesting refresh', 'error');
                throw new Error('job-not-found-refresh');
            }
            if (e.message && e.message.indexOf('job-conditions-not-met') >= 0 && decryptRetries < MAX_DECRYPT_RETRIES) {
                // Fall through to retry block below
            } else {
                throw e;
            }
        }
        if (decryptRetries < MAX_DECRYPT_RETRIES) {
            decryptRetries++;
            log('Decrypt incomplete — re-opening file to retry decryption (attempt ' + decryptRetries + '/' + MAX_DECRYPT_RETRIES + ')', 'warn');
            await delay(2000);
            ensureDecryptSolverEnabled();
            ensureIceWallSolverEnabled();
            ensureSimpleDecryptSolverEnabled();
            sendCmd('decrypt.file', { fileId: fileId });
            var retryOpen = await waitForMinigameOrError(12000);
            if (retryOpen.locked) throwMinigameLockError(retryOpen.locked);
            if (retryOpen.error) {
                var retryErrMsg2 = retryOpen.error.message || retryOpen.error.kind || '';
                if (retryErrMsg2.indexOf('file-already-decrypted') >= 0 || retryErrMsg2.indexOf('cannot-read-sai-file') >= 0) {
                    log('File already decrypted on retry — skipping to job completion', 'success');
                    await delay(1500);
                    continue;
                }
                log('Decrypt retry error: ' + retryErrMsg2, 'warn');
                await delay(1500);
                continue;
            } else if (retryOpen.timeout) {
                log('Minigame start not detected on retry', 'warn');
            }
            await waitForHackToBeDone();
            await delay(1500);
            continue;
        }
        return null;
    }
}

// ---- Shared: find file in download folder ----
function findFileInFolder(folderData, job, latestFileId, latestFileName, serverFileName) {
    if (!folderData || !folderData.data || !folderData.data.files) return null;
    var files = folderData.data.files;
    var target = null;
    var condFile = extractFileInfoFromConditions(job);

    if (latestFileId) {
        target = files.find(function (f) { return f.id === latestFileId; });
        if (target) { log('Matched file by update event ID: ' + target.name); return target; }
    }
    if (job.fileInfo && job.fileInfo.id) {
        target = files.find(function (f) { return f.id === job.fileInfo.id; });
        if (target) { log('Matched file by take event ID: ' + target.name); return target; }
    }
    if (condFile && condFile.id) {
        target = files.find(function (f) { return f.id === condFile.id; });
        if (target) { log('Matched file by conditions ID: ' + target.name); return target; }
    }
    if (job.fileInfo && job.fileInfo.name) {
        target = files.find(function (f) { return f.name === job.fileInfo.name; });
        if (target) { log('Matched file by name: ' + target.name); return target; }
    }
    if (condFile && condFile.name) {
        target = files.find(function (f) { return f.name === condFile.name; });
        if (target) { log('Matched file by conditions name: ' + target.name); return target; }
    }
    if (latestFileName) {
        target = files.find(function (f) { return f.name === latestFileName; });
        if (target) { log('Matched file by update event name: ' + target.name); return target; }
    }
    if (serverFileName) {
        var baseName = serverFileName.replace(/\.[^.]+$/, '');
        target = files.find(function (f) { return f.name && f.name.replace(/\.[^.]+$/, '') === baseName; });
        if (target) { log('Matched file by base name "' + baseName + '": ' + target.name); return target; }
    }
    if (job.fileInfo && job.fileInfo.name) {
        var fdBaseName = job.fileInfo.name.replace(/\.[^.]+$/, '');
        target = files.find(function (f) { return f.name && f.name.replace(/\.[^.]+$/, '') === fdBaseName; });
        if (target) { log('Matched file by base name "' + fdBaseName + '": ' + target.name); return target; }
    }
    // Fallback: encrypted files or isNew or last file
    var encFiles = files.filter(function (f) { return f.isEncrypted || (f.name && f.name.indexOf('.enc') >= 0); });
    if (encFiles.length > 0) {
        target = encFiles.find(function (f) { return f.isNew; }) || encFiles[encFiles.length - 1];
        if (target) { log('Matched encrypted file by fallback: ' + target.name, 'warn'); return target; }
    }
    var newFiles = files.filter(function (f) { return f.isNew; });
    if (newFiles.length === 1) {
        log('Matched file by single isNew file: ' + newFiles[0].name, 'warn');
        return newFiles[0];
    }
    target = files[files.length - 1];
    if (target) log('Matched file by final fallback (last): ' + target.name, 'warn');
    return target;
}

// ---- Shared: create file update listener ----
function createFileUpdateListener() {
    var latestFileId = null;
    var latestFileName = null;
    var handler = function (evt) {
        if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.data && evt.data.data.file) {
            latestFileId = evt.data.data.file.id;
            latestFileName = evt.data.data.file.name;
            log('File updated: ' + evt.data.data.file.name + ' (new id: ' + latestFileId + ')');
        }
    };
    window.addEventListener('message', handler);
    return {
        get fileId() { return latestFileId; },
        get fileName() { return latestFileName; },
        remove: function () { window.removeEventListener('message', handler); }
    };
}

// ---- Shared: extract file type from file name ----
function extractFileType(fileName) {
    if (!fileName) return null;
    var dotIdx = fileName.lastIndexOf('.');
    return dotIdx >= 0 ? fileName.substring(dotIdx) : null;
}

// ---- Shared: open folder and find file, throws on failure ----
async function openFolderAndFindFile(job, latestFileId, latestFileName, serverFileName) {
    if (!state.downloadFolderId) {
        await stepDiscoverDownloadFolder();
    }
    if (!state.downloadFolderId) {
        throw new Error('Download folder ID not found — could not discover Downloads folder');
    }

    log('Opening download folder');
    await delay(humanDelay());
    sendCmd('open.folder', { folderId: state.downloadFolderId });

    var folderData;
    try {
        folderData = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 10000);
    } catch (e) {
        throw new Error('Failed to open download folder');
    }

    var targetFile = findFileInFolder(folderData, job, latestFileId, latestFileName, serverFileName);
    if (!targetFile) {
        throw new Error('No file found in download folder');
    }

    // Extract file type
    var ft = extractFileType(targetFile.name);
    if (ft) job.fileType = ft;

    return targetFile;
}

// ---- Shared: early completion attempt for already-taken jobs ----
async function tryEarlyCompletion(job, continueMsg) {
    if (job.alreadyTaken && job.canComplete) {
        log('Job already taken and completable — completing now');
        try {
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
        } catch (earlyErr) {
            if (earlyErr.message && earlyErr.message.indexOf('job-conditions-not-met') >= 0) {
                log('Early completion failed (conditions not met) — continuing with ' + (continueMsg || 'remaining steps'), 'warn');
            } else {
                throw earlyErr;
            }
        }
        log('Completion failed — continuing with remaining steps');
    } else if (job.alreadyTaken) {
        log('Job already taken but not yet completable — continuing with remaining steps');
    }
    return null;
}

// ========================
// ---- Job Type Solvers ----
// ========================

// ---- File Decryption Job ----
async function solveFileDecryption(job) {
    log('=== File Decryption: ' + jobLabel(job) + ' ===');

    var fileListener = createFileUpdateListener();

    try {
        await stepTakeJob(job);

        var earlyReward = await tryEarlyCompletion(job, 'decrypt steps');
        if (earlyReward) return earlyReward;

        // Determine fileInfo
        var fileInfo = job.fileInfo || null;
        if (fileListener.fileId && fileInfo) {
            fileInfo.id = fileListener.fileId;
        }
        if (!fileInfo) {
            var condFile = extractFileInfoFromConditions(job);
            if (condFile) {
                fileInfo = condFile;
                if (fileListener.fileId) fileInfo.id = fileListener.fileId;
                log('Got file info from conditions: ' + condFile.name + ' (id: ' + condFile.id + ')');
            }
        }

        var targetFile = await openFolderAndFindFile(job, fileListener.fileId, fileListener.fileName, null);
        return await runDecryptFlow(targetFile.id, targetFile.name, job);
    } finally {
        fileListener.remove();
    }
}

// ---- IP Injection Job ----
async function solveIPInjection(job) {
    log('=== IP Injection: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for IP Injection job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting transit data');
    sendCmd('get.transit', { serverId: job.serverId });
    var transitData;
    try {
        transitData = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT', 10000);
    } catch (e) {
        throw new Error('Failed to get transit data');
    }

    if (transitData.error) {
        throw new Error('Transit error: ' + friendlyError(transitData.error.message || JSON.stringify(transitData.error)));
    }

    var ipsToInject = [];
    if (job.conditions) {
        for (var c of job.conditions) {
            if (c.details && c.details.ips && c.details.ips.length > 0) {
                ipsToInject = c.details.ips;
                break;
            }
            if (c.ip) { ipsToInject.push(c.ip); break; }
            if (c.targetIp) { ipsToInject.push(c.targetIp); break; }
        }
    }

    if (ipsToInject.length === 0) {
        throw new Error('Could not determine IPs to inject from job conditions');
    }

    for (var ipIdx = 0; ipIdx < ipsToInject.length; ipIdx++) {
        var ip = ipsToInject[ipIdx];
        log('Injecting IP (' + (ipIdx + 1) + '/' + ipsToInject.length + '): ' + ip);
        sendCmd('transit.add', { serverId: job.serverId, ip: ip, description: '' });

        try {
            var addResult = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT_ADD', 10000);
            if (addResult.error) {
                var errMsg = addResult.error.message || '';
                if (errMsg === 'sai-transit-ip-duplicate') {
                    log('IP ' + ip + ' already exists on server — skipping', 'warn');
                    if (ipIdx < ipsToInject.length - 1) await delay(humanDelay());
                    continue;
                }
                if (errMsg === 'sai-transit-ip-limit') {
                    var limit = addResult.error.limit || 20;
                    throw new Error('Server IP limit reached (' + limit + ' IPs max). Clear old IPs via Auto Clear IPs toggle.');
                }
                throw new Error('IP injection failed for ' + ip + ': ' + friendlyError(addResult.error.message));
            }
        } catch (e) {
            if (e.message.indexOf('Server IP limit reached') === 0) throw e;
            throw new Error('IP injection timed out for ' + ip + ': ' + e.message);
        }
        if (ipIdx < ipsToInject.length - 1) await delay(humanDelay());
    }

    log('All IPs injected successfully', 'success');
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- Data Download Job ----
async function solveDataDownload(job) {
    log('=== Data Download: ' + jobLabel(job) + ' ===');

    var fileListener = createFileUpdateListener();

    try {
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Data Download job');
        }

        var earlyReward = await tryEarlyCompletion(job, 'download/decrypt steps');
        if (earlyReward) return earlyReward;

        await stepSetEndpoint(job.serverId);
        await stepLogin(job.serverId);

        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        var filesData;
        try {
            filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            throw new Error('Failed to get server files');
        }

        if (filesData.error) {
            throw new Error('Files error: ' + friendlyError(filesData.error.message || JSON.stringify(filesData.error)));
        }

        var jobFile = null;
        var serverFileName = null;
        if (filesData.data && filesData.data.files) {
            jobFile = filesData.data.files.find(function (f) { return f.jobId === job.jobId; });
        }

        if (!jobFile) {
            log('Job file not found on server (may already be downloaded)', 'warn');
        } else {
            serverFileName = jobFile.name;
            log('Downloading file: ' + jobFile.name);
            sendCmd('file.download', { serverId: job.serverId, fileId: jobFile.fileId });

            try {
                var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 10000);
                if (dlResult.error) {
                    log('File download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
                }
            } catch (e) {
                log('File download timed out (may already be downloaded)', 'warn');
            }

            log('File downloaded', 'success');
        }
        await delay(humanDelay());

        var needsDecrypt = jobConditionsRequireDecrypt(job);
        if (!needsDecrypt) {
            var reward = null;
            try {
                reward = await stepCompleteJob(job);
            } catch (e) {
                if (e.message && e.message.indexOf('job-conditions-not-met') >= 0) {
                    log('Job conditions not met — file likely needs decryption', 'warn');
                    needsDecrypt = true;
                } else {
                    throw e;
                }
            }
            if (reward) return reward;
            if (!needsDecrypt) {
                log('Job not yet complete — checking if decryption needed');
                needsDecrypt = true;
            }
        } else {
            log('Job conditions require file decryption — proceeding to decrypt flow');
        }

        var condFile = extractFileInfoFromConditions(job);
        if (condFile) {
            log('Job conditions file: ' + (condFile.name || 'unknown') + ' (id: ' + (condFile.id || 'unknown') + ')');
        }

        var targetFile = await openFolderAndFindFile(job, fileListener.fileId, fileListener.fileName, serverFileName);
        return await runDecryptFlow(targetFile.id, targetFile.name, job);
    } finally {
        fileListener.remove();
    }
}

// ---- Log Deletion Job ----
async function solveLogDeletion(job) {
    log('=== Log Deletion: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for Log Deletion job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting server logs');
    sendCmd('get.logs', { serverId: job.serverId });
    var logsData;
    try {
        logsData = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 10000);
    } catch (e) {
        throw new Error('Failed to get server logs');
    }

    if (logsData.error) {
        throw new Error('Logs error: ' + friendlyError(logsData.error.message || JSON.stringify(logsData.error)));
    }

    var jobLog = null;
    if (logsData.data && logsData.data.logs) {
        jobLog = logsData.data.logs.find(function (l) { return l.jobId === job.jobId; });
    }

    if (!jobLog) {
        log('Job log not found on server (may already be deleted)', 'warn');
        return await stepCompleteJob(job);
    }

    log('Deleting log seq ' + jobLog.seq + ': ' + jobLog.message);
    sendCmd('log.delete', { serverId: job.serverId, seq: jobLog.seq });

    try {
        var delResult = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DELETE', 10000);
        if (delResult.error) {
            throw new Error('Log delete failed: ' + friendlyError(delResult.error.message || JSON.stringify(delResult.error)));
        }
    } catch (e) {
        throw new Error('Log delete timed out: ' + e.message);
    }

    log('Log deleted', 'success');
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- Log Download Job ----
async function solveLogDownload(job) {
    log('=== Log Download: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for Log Download job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting server logs');
    sendCmd('get.logs', { serverId: job.serverId });
    var logsData;
    try {
        logsData = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 10000);
    } catch (e) {
        throw new Error('Failed to get server logs');
    }

    if (logsData.error) {
        throw new Error('Logs error: ' + friendlyError(logsData.error.message || JSON.stringify(logsData.error)));
    }

    var jobLog = null;
    if (logsData.data && logsData.data.logs) {
        jobLog = logsData.data.logs.find(function (l) { return l.jobId === job.jobId; });
    }

    if (!jobLog) {
        log('Job log not found on server (may already be downloaded)', 'warn');
        return await stepCompleteJob(job);
    }

    log('Downloading log seq ' + jobLog.seq + ': ' + jobLog.message);
    sendCmd('log.download', { serverId: job.serverId, seq: jobLog.seq });

    try {
        var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DOWNLOAD', 10000);
        if (dlResult.error) {
            log('Log download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
        }
    } catch (e) {
        log('Log download timed out (may already be downloaded)', 'warn');
    }

    log('Log downloaded', 'success');
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- Decrypt & Extract Job ----
async function solveDecryptExtract(job) {
    log('=== Decrypt & Extract: ' + jobLabel(job) + ' ===');

    var fileListener = createFileUpdateListener();

    try {
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Decrypt & Extract job');
        }

        var earlyReward = await tryEarlyCompletion(job, 'download/decrypt steps');
        if (earlyReward) return earlyReward;

        await stepSetEndpoint(job.serverId);
        await stepLogin(job.serverId);

        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        var filesData;
        try {
            filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            throw new Error('Failed to get server files');
        }

        if (filesData.error) {
            var filesErr = filesData.error.message || JSON.stringify(filesData.error);
            if (filesErr.indexOf('missing-software') >= 0 || filesErr.indexOf('software') >= 0) {
                throw new Error('Missing required software on server — cannot access files');
            }
            throw new Error('Files error: ' + filesErr);
        }

        var jobFile = null;
        var serverFileName = null;
        if (filesData.data && filesData.data.files) {
            jobFile = filesData.data.files.find(function (f) { return f.jobId === job.jobId; });
        }

        if (!jobFile) {
            log('Job file not found on server (may already be downloaded)', 'warn');
        } else {
            serverFileName = jobFile.name;
            log('Downloading file: ' + jobFile.name);
            sendCmd('file.download', { serverId: job.serverId, fileId: jobFile.fileId });

            try {
                var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 10000);
                if (dlResult.error) {
                    log('File download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
                }
            } catch (e) {
                log('File download timed out (may already be downloaded)', 'warn');
            }

            log('File downloaded — now opening for decryption', 'success');
        }
        await delay(humanDelay());

        var targetFile = await openFolderAndFindFile(job, fileListener.fileId, fileListener.fileName, serverFileName);
        return await runDecryptFlow(targetFile.id, targetFile.name, job);
    } finally {
        fileListener.remove();
    }
}

// ---- File Elimination (DeleteFile) Job ----
async function solveFileElimination(job) {
    log('=== File Elimination: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for File Elimination job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting server files');
    sendCmd('get.files', { serverId: job.serverId });
    var filesData;
    try {
        filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
    } catch (e) {
        throw new Error('Failed to get server files');
    }

    if (filesData.error) {
        throw new Error('Files error: ' + friendlyError(filesData.error.message || JSON.stringify(filesData.error)));
    }

    var jobFile = null;
    var targetFileIds = [];
    if (job.conditions) {
        for (var c = 0; c < job.conditions.length; c++) {
            if (job.conditions[c].type === 'DeleteFile' && job.conditions[c].details && job.conditions[c].details.fileIds) {
                targetFileIds = job.conditions[c].details.fileIds;
                break;
            }
        }
    }
    if (filesData.data && filesData.data.files) {
        jobFile = filesData.data.files.find(function (f) { return f.jobId === job.jobId; });
        if (!jobFile && targetFileIds.length > 0) {
            jobFile = filesData.data.files.find(function (f) { return targetFileIds.indexOf(f.fileId) >= 0; });
        }
        if (!jobFile) {
            jobFile = filesData.data.files.find(function (f) { return f.source === 'job'; });
        }
    }

    if (!jobFile) {
        log('Job file not found on server (may already be deleted)', 'warn');
        return await stepCompleteJob(job);
    }

    log('Deleting file: ' + jobFile.name + ' (fileId: ' + jobFile.fileId + ')');
    sendCmd('file.delete', { serverId: job.serverId, fileId: jobFile.fileId });

    try {
        var delResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DELETE', 10000);
        if (delResult.error) {
            throw new Error('File delete failed: ' + friendlyError(delResult.error.message || JSON.stringify(delResult.error)));
        }
    } catch (e) {
        throw new Error('File delete timed out: ' + e.message);
    }

    log('File deleted', 'success');
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- Data Upload (UploadFile) Job ----
async function solveDataUpload(job) {
    log('=== Data Upload: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for Data Upload job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    var uploadFile = job.fileInfo || null;
    if (!uploadFile && job.conditions) {
        for (var c = 0; c < job.conditions.length; c++) {
            if (job.conditions[c].type === 'UploadFile' && job.conditions[c].details && job.conditions[c].details.files && job.conditions[c].details.files.length > 0) {
                uploadFile = job.conditions[c].details.files[0];
                break;
            }
        }
    }
    if (!uploadFile) {
        throw new Error('Could not determine file to upload from job conditions');
    }

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting server files');
    sendCmd('get.files', { serverId: job.serverId });
    try {
        await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
    } catch (e) {
        log('Failed to get server files (non-fatal)', 'warn');
    }
    await delay(humanDelay());

    log('Uploading file: ' + uploadFile.name);
    sendCmd('file.upload', { serverId: job.serverId, name: uploadFile.name, sizeMb: 0 });

    try {
        await waitForEvent('COR3_AUTOJOB_SAI_FILE_UPLOAD', 10000);
        log('File upload confirmed by server', 'success');
    } catch (e) {
        log('File upload response not received (trying to complete anyway)', 'warn');
    }
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- IP Cleanup (DeleteIps) Job ----
async function solveIPCleanup(job) {
    log('=== IP Cleanup: ' + jobLabel(job) + ' ===');

    await stepTakeJob(job);

    if (!job.serverId) {
        throw new Error('No target server for IP Cleanup job');
    }

    var earlyReward = await tryEarlyCompletion(job);
    if (earlyReward) return earlyReward;

    await stepSetEndpoint(job.serverId);
    await stepLogin(job.serverId);

    log('Getting transit data');
    sendCmd('get.transit', { serverId: job.serverId });
    var transitData;
    try {
        transitData = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT', 10000);
    } catch (e) {
        throw new Error('Failed to get transit data');
    }

    if (transitData.error) {
        throw new Error('Transit error: ' + friendlyError(transitData.error.message || JSON.stringify(transitData.error)));
    }

    var ipsToRemove = [];
    if (job.conditions) {
        for (var c = 0; c < job.conditions.length; c++) {
            if (job.conditions[c].type === 'DeleteIps' && job.conditions[c].details && job.conditions[c].details.ips) {
                ipsToRemove = job.conditions[c].details.ips;
                break;
            }
        }
    }

    if (ipsToRemove.length === 0 && transitData.data && transitData.data.ips) {
        var jobIps = transitData.data.ips.filter(function (entry) {
            return entry.source === 'job' && entry.jobId === job.jobId;
        });
        ipsToRemove = jobIps.map(function (entry) { return entry.ip; });
        if (ipsToRemove.length > 0) {
            log('Found ' + ipsToRemove.length + ' IP(s) to remove from transit data (source=job)');
        }
    }

    if (ipsToRemove.length === 0) {
        throw new Error('Could not determine IPs to remove from job conditions or transit data');
    }

    for (var ipIdx = 0; ipIdx < ipsToRemove.length; ipIdx++) {
        var ip = ipsToRemove[ipIdx];
        log('Removing IP (' + (ipIdx + 1) + '/' + ipsToRemove.length + '): ' + ip);
        sendCmd('transit.remove', { serverId: job.serverId, ip: ip });

        try {
            var rmResult = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT_REMOVE', 10000);
            if (rmResult.error) {
                throw new Error('IP removal failed for ' + ip + ': ' + friendlyError(rmResult.error.message || JSON.stringify(rmResult.error)));
            }
        } catch (e) {
            throw new Error('IP removal timed out for ' + ip + ': ' + e.message);
        }
        if (ipIdx < ipsToRemove.length - 1) await delay(humanDelay());
    }

    log('All IPs removed successfully', 'success');
    await delay(humanDelay());

    return await stepCompleteJob(job);
}

// ---- Main job dispatcher ----
export async function solveJob(job) {
    var type = job.type || job.name;
    switch (type) {
        case 'File Decryption':
            return await solveFileDecryption(job);
        case 'IP Injection':
            return await solveIPInjection(job);
        case 'Data Download':
            return await solveDataDownload(job);
        case 'Log Deletion':
            return await solveLogDeletion(job);
        case 'Log Download':
            return await solveLogDownload(job);
        case 'Decrypt & Extract':
            return await solveDecryptExtract(job);
        case 'File Elimination':
            return await solveFileElimination(job);
        case 'Data Upload':
            return await solveDataUpload(job);
        case 'IP Cleanup':
            return await solveIPCleanup(job);
        default:
            throw new Error('Unsupported job type: ' + type);
    }
}
