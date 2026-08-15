// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom (the CRA/Jest test env) doesn't provide TextEncoder/TextDecoder, but the
// .authbook binary codec (extbkFormat.js) constructs them at module load. Without
// this polyfill any test that transitively imports App.js fails to run with
// "TextEncoder is not defined". Pull them from Node's util module.
import { TextEncoder, TextDecoder } from 'util';
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

// jsdom also ships no WebCrypto. epkFormat.js needs SHA-256 for every entry and
// Ed25519 for signatures, and pkce.js needs getRandomValues — all of which exist
// in Node's crypto.webcrypto. Without this, anything importing the EPK reader
// fails with "WebCrypto unavailable" rather than a real assertion.
import { webcrypto } from 'crypto';
if (!global.crypto?.subtle) global.crypto = webcrypto;
