// msgpack-codec.js — COR3 Helper msgpack + Socket.IO v5 binary packet codec
// Uses notepack.io loaded locally via manifest content_scripts (notepack.min.js).
// Provides helpers to convert between legacy 42[...] string format and binary packets.

(function (root) {
    'use strict';

    // notepack.min.js is loaded before this script via manifest content_scripts,
    // so root.notepack (window.notepack) is already available.
    var notepackLib = root.notepack || null;
    var notepackReady = !!notepackLib;

    function ensureNotepack(cb) {
        if (notepackLib) { cb(notepackLib); return; }
        // Fallback: check again in case of timing
        notepackLib = root.notepack || null;
        notepackReady = !!notepackLib;
        if (notepackLib) { cb(notepackLib); return; }
        console.log('[COR3 Codec] notepack.io not available — check that notepack.min.js is loaded before msgpack-codec.js in manifest');
    }

    if (notepackReady) {
        console.log('[COR3 Codec] notepack.io loaded');
    }

    function decodeRaw(buf) {
        if (!notepackLib) throw new Error('notepack not loaded');
        return notepackLib.decode(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf);
    }

    function encodeRaw(obj) {
        if (!notepackLib) throw new Error('notepack not loaded');
        return notepackLib.encode(obj);
    }

    // Convert a binary WS message (ArrayBuffer or Blob) into the decoded SIO packet object.
    // SIO v5 binary packets are just msgpack({type, data, nsp, id?}).
    // data is typically ["eventName", {payload}] for EVENT (type=2).
    function decodeBinaryPacket(rawData) {
        if (rawData instanceof ArrayBuffer) {
            return decodeRaw(rawData);
        }
        if (rawData instanceof Uint8Array) {
            return decodeRaw(rawData);
        }
        throw new Error('Unsupported binary type');
    }

    // Async version that handles Blob
    function decodeBinaryPacketAsync(rawData) {
        if (rawData instanceof Blob) {
            return rawData.arrayBuffer().then(function (buf) {
                return decodeRaw(new Uint8Array(buf));
            });
        }
        return Promise.resolve(decodeBinaryPacket(rawData));
    }

    // Convert decoded SIO packet to legacy 42[...] string for backward compatibility.
    // Only EVENT (type=2) and ACK (type=3) packets have data arrays.
    function packetToString(packet) {
        if (!packet || typeof packet !== 'object') return null;
        var t = packet.type;
        if (t !== 2 && t !== 3) {
            if (t === 0) return '40' + (packet.data ? JSON.stringify(packet.data) : '');
            if (t === 1) return '41';
            if (t === 4) return '44' + (packet.data ? JSON.stringify(packet.data) : '');
            return null;
        }
        if (!Array.isArray(packet.data) || packet.data.length < 1) return null;
        var prefix = '4' + t;
        if (packet.nsp && packet.nsp !== '/') prefix += packet.nsp + ',';
        if (packet.id !== undefined && packet.id !== null) prefix += packet.id;
        return prefix + JSON.stringify(packet.data);
    }

    // Convert legacy 42["event",{...}] string to a binary msgpack SIO packet (ArrayBuffer).
    function stringToPacketBuffer(str) {
        if (typeof str !== 'string') return null;
        var m = str.match(/^4([0-4])(\/[^,]*,)?(\d*)(\[.+)$/s);
        if (!m) return null;
        var pkt = {
            type: parseInt(m[1], 10),
            nsp: m[2] ? m[2].slice(0, -1) : '/'
        };
        if (m[3]) pkt.id = parseInt(m[3], 10);
        try { pkt.data = JSON.parse(m[4]); } catch (e) { return null; }
        return encodeRaw(pkt);
    }

    // Check if data is binary (ArrayBuffer, Blob, or typed array)
    function isBinary(data) {
        return data instanceof ArrayBuffer || data instanceof Blob ||
            (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(data));
    }

    var codec = {
        ensureLoaded: ensureNotepack,
        isReady: function () { return notepackReady; },
        encode: encodeRaw,
        decode: decodeRaw,
        decodeBinaryPacket: decodeBinaryPacket,
        decodeBinaryPacketAsync: decodeBinaryPacketAsync,
        packetToString: packetToString,
        stringToPacketBuffer: stringToPacketBuffer,
        isBinary: isBinary
    };

    root.__cor3MsgpackCodec = codec;

})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
