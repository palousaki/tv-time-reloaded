// Tiny cross-screen signal: add-show sets this when a show is actually added,
// so Search can tell "came back after adding" apart from "went back without
// adding" and only clear its query/results in the former case.
let showWasAdded = false;

export function markShowAdded() {
  showWasAdded = true;
}

export function consumeShowAdded(): boolean {
  const value = showWasAdded;
  showWasAdded = false;
  return value;
}
