// Hidden checks are commands a trial asks the workspace to run. An order
// fetched from outside the runner is attacker-controlled, so the command is
// not a free string: only `node --test` on an optional relative path.

const RELATIVE_TEST = /^[A-Za-z0-9._/-]{1,200}$/;

export function allowedHiddenTestCommand(command: readonly string[]) {
  if (command.length < 2 || command.length > 3) return false;
  if (command[0] !== "node" || command[1] !== "--test") return false;
  const path = command[2];
  if (path === undefined) return true;
  return (
    RELATIVE_TEST.test(path) && !path.includes("..") && !path.startsWith("/")
  );
}
