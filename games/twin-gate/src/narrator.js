// TALLY: the evaluation system. Global lines (deaths, fizzles, restarts, completion quips); per-trial lines live
// with each chamber in levels.js. Lines are picked without repeating the last one.
import { say } from './hud.js';

const G = {
  die: ['Candidate expired. Reconstituting. Please do not make this a habit; the paperwork is triplicate.',
    'That was the floor of the incident report. You will be back momentarily.',
    'Death noted. Your next of kin has been notified that there is no next of kin.',
    'I have restored you from the last checkpoint. The checkpoint is fine. Thank you for asking.'],
  acid: ['Caustic ink. It says so on the label. The label is also caustic.', 'You dissolved. Beautifully. I have attached a photo to your file.'],
  laser: ['The beam is warm. You are now also warm. Everyone learned something.'],
  restart: ['Restarting the trial. Everything is where you left it, except you.', 'From the top. I will pretend I did not see that.', 'Trial reset. The block has been told nothing.'],
  gridFizzle: ['The grid has reclaimed your gates. It is not personal. It is not a person.', 'Emancipated. Your gates are free now. Free and gone.'],
  fizzleBlock: ['That block has been emancipated. A replacement is on its way. It will not remember its predecessor.'],
  fail: ['That surface will not hold a gate.', 'No gate. Try a light panel.', 'The device declined. It has standards.'],
  idle: ['Take your time. I am timing it.', 'The clock is running. It is always running. That is what clocks are for.'],
  quips: ['Satisfactory. I have upgraded you from "specimen" to "participant".', 'Complete. Your results have been averaged with a houseplant for context.',
    'Well done. That phrase is on a list of things I am required to say.', 'You did it. I am recording a small, measured amount of approval.',
    'Complete. If it helps, the previous candidate is now a door.', 'Excellent. By which I mean the trial ended.'],
  record: ['A new record. I have moved your file slightly to the left.', 'Faster than last time. The trend is concerning, for me.'],
};
const last = {};
export function line(key) {
  const a = G[key]; if (!a) return null;
  let i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === last[key]) i = (i + 1) % a.length; last[key] = i;
  return a[i];
}
export function tally(key, chamber, opts) {
  const c = chamber && chamber.say && chamber.say[key];
  const txt = c ? (Array.isArray(c) ? c : [c]) : [line(key)];
  // `now` clears the queue for the first line only, so a multi-line entry keeps its later lines
  txt.filter(Boolean).forEach((t, k) => say(t, { ...opts, now: !!(opts && opts.now) && k === 0, delay: (opts && opts.delay) || (k ? 0.2 : 0) }));
}
