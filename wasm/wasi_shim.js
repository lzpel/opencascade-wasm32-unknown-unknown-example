// Minimal `wasi_snapshot_preview1` shim for the cadrum wasm build.
//
// OCCT's OSD (file/process/clock) layer is stubbed out by cadrum's build.rs,
// so cadrum's in-memory STEP -> GLB path does not actually touch the
// filesystem. The wasm module still *imports* the WASI ABI (because libc++ /
// wasi-libc reference it), so we must satisfy those imports at instantiation.
//
// We provide just enough: fd_write routes stdout(1)/stderr(2) to the console
// so Rust panics are visible; everything else returns a benign errno. No real
// file/clock/env capability is granted, matching the stubbed OSD layer.

const WASI_ESUCCESS = 0;
const WASI_EBADF = 8;
const WASI_ENOSYS = 52;

// Set by the init glue once wasm is instantiated so fd_write can read memory.
let memory = null;
export function __setWasiMemory(mem) {
  memory = mem;
}

const decoder = new TextDecoder("utf-8");
let stdoutBuf = "";
let stderrBuf = "";

function writev(fd, iovsPtr, iovsLen, nwrittenPtr) {
  if (!memory) return WASI_EBADF;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  let written = 0;
  let text = "";
  for (let i = 0; i < iovsLen; i++) {
    const base = view.getUint32(iovsPtr + i * 8, true);
    const len = view.getUint32(iovsPtr + i * 8 + 4, true);
    text += decoder.decode(bytes.subarray(base, base + len));
    written += len;
  }
  view.setUint32(nwrittenPtr, written, true);
  // Buffer until newline so console lines stay coherent.
  if (fd === 2) {
    stderrBuf += text;
    let nl;
    while ((nl = stderrBuf.indexOf("\n")) >= 0) {
      console.error("[wasm stderr]", stderrBuf.slice(0, nl));
      stderrBuf = stderrBuf.slice(nl + 1);
    }
  } else {
    stdoutBuf += text;
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      console.log("[wasm stdout]", stdoutBuf.slice(0, nl));
      stdoutBuf = stdoutBuf.slice(nl + 1);
    }
  }
  return WASI_ESUCCESS;
}

export const fd_write = (fd, iovsPtr, iovsLen, nwrittenPtr) =>
  writev(fd, iovsPtr, iovsLen, nwrittenPtr);

// proc_exit: a Rust panic with panic=abort lands here. Surface it loudly.
export const proc_exit = (code) => {
  throw new Error("wasm proc_exit(" + code + ") — likely a Rust panic/abort");
};

// environ: report an empty environment.
export const environ_sizes_get = (countPtr, sizePtr) => {
  if (!memory) return WASI_EBADF;
  const view = new DataView(memory.buffer);
  view.setUint32(countPtr, 0, true);
  view.setUint32(sizePtr, 0, true);
  return WASI_ESUCCESS;
};
export const environ_get = () => WASI_ESUCCESS;

// Everything else: no real capability. Return ENOSYS/EBADF so callers fail
// gracefully (these are not on the in-memory STEP -> GLB path).
export const clock_time_get = () => WASI_ENOSYS;
export const fd_close = () => WASI_EBADF;
export const fd_fdstat_get = () => WASI_EBADF;
export const fd_fdstat_set_flags = () => WASI_EBADF;
export const fd_prestat_get = () => WASI_EBADF;
export const fd_prestat_dir_name = () => WASI_EBADF;
export const fd_read = () => WASI_EBADF;
export const fd_seek = () => WASI_EBADF;
export const path_filestat_get = () => WASI_EBADF;
export const path_open = () => WASI_EBADF;
