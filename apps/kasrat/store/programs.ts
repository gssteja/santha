// Jeff Nippard — High-Frequency Full-Body split ("Full Body Science Applied" series).
// Five full-body days, each with a different muscle focus; every body part hit each session.
// Day 1 = Leg Focus (quads / hamstrings / glutes). More focus days added as covered.
//
// Squat runs a 4-week weekly-undulating wave: heavy 4×4 @80% 1RM and light 3×6 @75% alternate
// week to week, adding load on the heavy weeks. Keep ~2-3 reps in reserve (no failure on heavy
// compounds — protects recovery for the next day on a high-frequency split). Only the biceps
// curl is taken to failure. Pairs can be run as supersets if short on time.

export type ProgramExercise = {
  name: string;
  sets: number;
  reps: string;
  muscle?: string;
};

export type ProgramDay = {
  name: string;
  exercises: ProgramExercise[];
};

export type Program = {
  id: string;
  name: string;
  author: string;
  split: string;
  daysPerCycle: number;
  description: string;
  days: ProgramDay[];
};

export const PROGRAMS: Program[] = [
  {
    id: 'nippard-hf-fullbody',
    name: 'High-Frequency Full Body',
    author: 'Jeff Nippard',
    split: 'Full Body',
    daysPerCycle: 5,
    description: 'Five full-body days a week, each with a different focus. Day 1 prioritizes legs. The squat alternates weekly — heavy 4×4 @ 80% 1RM one week, lighter 3×6 @ 75% the next — adding load on the heavy weeks. Leave 2–3 reps in the tank on the squat; only the curl goes to failure.',
    days: [
      {
        name: 'Day 1 — Leg Focus',
        exercises: [
          { name: 'Squat (heavy wk: 4×4 @80% · light wk: 3×6 @75%)', sets: 4, reps: '4 / 6', muscle: 'Quads' },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '8', muscle: 'Chest' },
          { name: 'Lying Leg Curl', sets: 3, reps: '10', muscle: 'Hamstrings' },
          { name: 'Lat Pulldown', sets: 3, reps: '10', muscle: 'Back' },
          { name: 'EZ-Bar Biceps Curl (drop set, to failure)', sets: 3, reps: '12 + 12 drop', muscle: 'Biceps' },
          { name: 'Hanging Leg Raise', sets: 3, reps: '12', muscle: 'Core' },
        ],
      },
    ],
  },
];

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find(p => p.id === id);
}
