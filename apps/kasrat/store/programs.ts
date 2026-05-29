// Jeff Nippard — Pure Bodybuilding "Full Body" program, extracted from the official spreadsheet.
// 5 training days per week (Full Body #1–4 + Arms & Weak Points) with rest days between blocks.

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
    id: 'nippard-fullbody',
    name: 'Pure Bodybuilding Full Body',
    author: 'Jeff Nippard',
    split: 'Full Body',
    daysPerCycle: 7,
    description: 'High-frequency full body. Five sessions a week — four full-body days plus a dedicated arms & weak-points day. Stretch-mediated hypertrophy, last-set intensity, rest days between blocks.',
    days: [
      {
        name: 'Full Body #1',
        exercises: [
          { name: 'Cross-Body Lat Pull-Around', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Low Incline Smith Machine Press', sets: 3, reps: '8–10', muscle: 'Chest' },
          { name: 'Machine Hip Adduction', sets: 3, reps: '10–12', muscle: 'Glutes' },
          { name: 'Leg Press', sets: 3, reps: '8', muscle: 'Quads' },
          { name: 'Lying Paused Rope Face Pull', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Cable Crunch', sets: 3, reps: '10–12', muscle: 'Core' },
        ],
      },
      {
        name: 'Full Body #2',
        exercises: [
          { name: 'Seated DB Shoulder Press', sets: 3, reps: '10', muscle: 'Shoulders' },
          { name: 'Paused Barbell RDL', sets: 2, reps: '8', muscle: 'Hamstrings' },
          { name: 'Chest-Supported Machine Row', sets: 3, reps: '8–10', muscle: 'Back' },
          { name: 'Hammer Preacher Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Cuffed Behind-The-Back Lateral Raise', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Overhead Cable Triceps Extension (Bar)', sets: 2, reps: '8–10', muscle: 'Triceps' },
        ],
      },
      {
        name: 'Full Body #3',
        exercises: [
          { name: 'Superset A1: Assisted Pull-Up', sets: 4, reps: '8–10', muscle: 'Back' },
          { name: 'Superset A2: Paused Assisted Dip', sets: 4, reps: '8–10', muscle: 'Chest' },
          { name: 'Superset B1: Seated Leg Curl', sets: 3, reps: '10–12', muscle: 'Hamstrings' },
          { name: 'Superset B2: Leg Extension', sets: 3, reps: '10–12', muscle: 'Quads' },
          { name: 'Cable Paused Shrug-In', sets: 3, reps: '10–12', muscle: 'Traps' },
          { name: 'Roman Chair Leg Raise', sets: 3, reps: '10–20', muscle: 'Core' },
        ],
      },
      {
        name: 'Full Body #4',
        exercises: [
          { name: 'Lying Leg Curl', sets: 2, reps: '8–10', muscle: 'Hamstrings' },
          { name: 'Hack Squat', sets: 3, reps: '4, 6, 8', muscle: 'Quads' },
          { name: 'Bent-Over Cable Pec Flye', sets: 3, reps: '10–12', muscle: 'Chest' },
          { name: 'Neutral-Grip Lat Pulldown', sets: 2, reps: '12–15', muscle: 'Back' },
          { name: 'Leg Press Calf Press', sets: 3, reps: '10–12', muscle: 'Calves' },
          { name: 'Cable Reverse Flye (Mechanical Dropset)', sets: 3, reps: '5, 4, 3+', muscle: 'Shoulders' },
        ],
      },
      {
        name: 'Arms & Weak Points',
        exercises: [
          { name: 'Weak Point Exercise #1', sets: 3, reps: '8–12', muscle: 'Weak Point' },
          { name: 'Weak Point Exercise #2 (optional)', sets: 2, reps: '8–12', muscle: 'Weak Point' },
          { name: 'Bayesian Cable Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Triceps Pressdown (Bar)', sets: 3, reps: '8', muscle: 'Triceps' },
          { name: 'Bottom-2/3 Constant Tension Preacher Curl', sets: 2, reps: '12–15', muscle: 'Biceps' },
          { name: 'Cable Triceps Kickback', sets: 2, reps: '12–15', muscle: 'Triceps' },
          { name: 'Standing Calf Raise', sets: 3, reps: '12–15', muscle: 'Calves' },
        ],
      },
    ],
  },
];

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find(p => p.id === id);
}
