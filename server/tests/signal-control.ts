// Windows child.kill terminates the process without invoking Node's signal handlers.
// This test-only preload exercises the real entry point's handler through its IPC channel.
process.once("message", (message) => {
  if (message !== "shutdown-test") {
    return;
  }

  process.emit("SIGTERM", "SIGTERM");
  process.disconnect?.();
});
