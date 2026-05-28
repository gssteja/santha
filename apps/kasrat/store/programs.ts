// Jeff Nippard Pure Bodybuilding Program data extracted from official spreadsheets

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
    id: 'nippard-ppl',
    name: 'Pure Bodybuilding PPL',
    author: 'Jeff Nippard',
    split: 'Push/Pull/Legs',
    daysPerCycle: 10,
    description: 'Asynchronous PPL running on a 10-day cycle. Emphasis on stretch-mediated hypertrophy and last-set intensity techniques.',
    days: [
      {
        name: 'Pull #1 — Lat Focus',
        exercises: [
          { name: 'Cross-Body Lat Pull-Around', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Snatch-Grip RDL', sets: 2, reps: '8', muscle: 'Hamstrings' },
          { name: 'Chest-Supported Machine Row', sets: 3, reps: '8–10', muscle: 'Back' },
          { name: 'Straight-Bar Lat Prayer', sets: 3, reps: '12–15', muscle: 'Back' },
          { name: 'Hammer Preacher Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Lying Paused Rope Face Pull', sets: 3, reps: '10–12', muscle: 'Shoulders' },
        ],
      },
      {
        name: 'Push #1',
        exercises: [
          { name: 'Cuffed Behind-The-Back Lateral Raise', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Low Incline Smith Machine Press', sets: 4, reps: '8–10', muscle: 'Chest' },
          { name: 'Pec Deck (w/ Integrated Partials)', sets: 3, reps: '12–15', muscle: 'Chest' },
          { name: 'Overhead Cable Triceps Extension', sets: 3, reps: '8', muscle: 'Triceps' },
          { name: 'Triceps Pressdown', sets: 2, reps: '8–10', muscle: 'Triceps' },
          { name: 'Cable Crunch', sets: 3, reps: '10–12', muscle: 'Core' },
        ],
      },
      {
        name: 'Legs #1',
        exercises: [
          { name: 'Seated Leg Curl', sets: 3, reps: '8–10', muscle: 'Hamstrings' },
          { name: 'Machine Hip Adduction', sets: 3, reps: '10–12', muscle: 'Glutes' },
          { name: 'Hack Squat', sets: 3, reps: '4, 6, 8', muscle: 'Quads' },
          { name: 'Leg Extension', sets: 3, reps: '10–12', muscle: 'Quads' },
          { name: 'Leg Press Calf Press', sets: 3, reps: '12–15', muscle: 'Calves' },
        ],
      },
      {
        name: 'Arms & Weak Points #1',
        exercises: [
          { name: 'Bayesian Cable Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Seated DB French Press', sets: 3, reps: '10', muscle: 'Triceps' },
          { name: 'Constant Tension Preacher Curl', sets: 2, reps: '12–15', muscle: 'Biceps' },
          { name: 'Cable Triceps Kickback', sets: 2, reps: '12–15', muscle: 'Triceps' },
          { name: 'Roman Chair Leg Raise', sets: 3, reps: '10–20', muscle: 'Core' },
        ],
      },
      {
        name: 'Pull #2 — Mid-Back Focus',
        exercises: [
          { name: 'Super-ROM Overhand Cable Row', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Arms-Extended 45° Hyperextension', sets: 2, reps: '10–20', muscle: 'Back' },
          { name: 'Lean-Back Lat Pulldown', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Inverse DB Zottman Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Cable Reverse Flye', sets: 3, reps: '5, 4, 3+', muscle: 'Shoulders' },
          { name: 'Cable Paused Shrug-In', sets: 3, reps: '10–12', muscle: 'Traps' },
        ],
      },
      {
        name: 'Push #2',
        exercises: [
          { name: 'Machine Shoulder Press', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Cross-Body Cable Y-Raise', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Paused Assisted Dip', sets: 3, reps: '8–10', muscle: 'Chest' },
          { name: 'Low-Incline Dumbbell Flye', sets: 2, reps: '15–20', muscle: 'Chest' },
          { name: 'Katana Triceps Extension', sets: 3, reps: '10–12', muscle: 'Triceps' },
          { name: 'Ab Wheel Rollout', sets: 3, reps: '10–20', muscle: 'Core' },
        ],
      },
      {
        name: 'Legs #2',
        exercises: [
          { name: 'Lying Leg Curl', sets: 3, reps: '8–10', muscle: 'Hamstrings' },
          { name: 'Leg Press', sets: 3, reps: '8', muscle: 'Quads' },
          { name: 'Smith Machine Lunge', sets: 2, reps: '8', muscle: 'Quads' },
          { name: 'Machine Hip Adduction', sets: 3, reps: '10–12', muscle: 'Glutes' },
          { name: 'Sissy Squat', sets: 3, reps: '10–12', muscle: 'Quads' },
          { name: 'Standing Calf Raise', sets: 3, reps: '10–12', muscle: 'Calves' },
        ],
      },
      {
        name: 'Arms & Weak Points #2',
        exercises: [
          { name: 'Cable Skull Crusher', sets: 3, reps: '10–12', muscle: 'Triceps' },
          { name: 'Kneeling Overhead Cable Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Triceps Diverging Pressdown', sets: 2, reps: '12–15', muscle: 'Triceps' },
          { name: 'Incline DB Stretch-Curl', sets: 2, reps: '12–15', muscle: 'Biceps' },
          { name: 'Cable Crunch', sets: 3, reps: '10–12', muscle: 'Core' },
        ],
      },
    ],
  },
  {
    id: 'nippard-ul',
    name: 'Pure Bodybuilding Upper/Lower',
    author: 'Jeff Nippard',
    split: 'Upper/Lower',
    daysPerCycle: 7,
    description: '4-day Upper/Lower with an optional arms & weak points day. Runs on a standard weekly cycle.',
    days: [
      {
        name: 'Upper #1',
        exercises: [
          { name: 'Cuffed Behind-The-Back Lateral Raise', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Cross-Body Lat Pull-Around', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Low Incline Smith Machine Press', sets: 4, reps: '8–10', muscle: 'Chest' },
          { name: 'Chest-Supported Machine Row', sets: 3, reps: '8–10', muscle: 'Back' },
          { name: 'Overhead Cable Triceps Extension', sets: 2, reps: '8–10', muscle: 'Triceps' },
          { name: 'Straight-Bar Lat Prayer', sets: 3, reps: '12–15', muscle: 'Back' },
          { name: 'Pec Deck (w/ Integrated Partials)', sets: 3, reps: '12–15', muscle: 'Chest' },
        ],
      },
      {
        name: 'Lower #1',
        exercises: [
          { name: 'Seated Leg Curl', sets: 3, reps: '8–10', muscle: 'Hamstrings' },
          { name: 'Machine Hip Adduction', sets: 3, reps: '10–12', muscle: 'Glutes' },
          { name: 'Hack Squat', sets: 3, reps: '4, 6, 8', muscle: 'Quads' },
          { name: 'Leg Extension', sets: 3, reps: '10–12', muscle: 'Quads' },
          { name: 'Leg Press Calf Press', sets: 3, reps: '12–15', muscle: 'Calves' },
        ],
      },
      {
        name: 'Upper #2',
        exercises: [
          { name: 'Super-ROM Overhand Cable Row', sets: 3, reps: '10–12', muscle: 'Back' },
          { name: 'Machine Shoulder Press', sets: 3, reps: '10–12', muscle: 'Shoulders' },
          { name: 'Assisted Pull-Up', sets: 3, reps: '8–10', muscle: 'Back' },
          { name: 'Paused Assisted Dip', sets: 3, reps: '8–10', muscle: 'Chest' },
          { name: 'Inverse DB Zottman Curl', sets: 2, reps: '10–12', muscle: 'Biceps' },
          { name: 'Super-ROM DB Lateral Raise', sets: 3, reps: '12–15', muscle: 'Shoulders' },
          { name: 'Cable Reverse Flye', sets: 3, reps: '5, 4, 3+', muscle: 'Shoulders' },
        ],
      },
      {
        name: 'Lower #2',
        exercises: [
          { name: 'Lying Leg Curl', sets: 3, reps: '8–10', muscle: 'Hamstrings' },
          { name: 'Leg Press', sets: 3, reps: '8', muscle: 'Quads' },
          { name: 'Paused Barbell RDL', sets: 2, reps: '8', muscle: 'Hamstrings' },
          { name: 'Machine Hip Adduction', sets: 3, reps: '10–12', muscle: 'Glutes' },
          { name: 'Sissy Squat', sets: 3, reps: '10–12', muscle: 'Quads' },
          { name: 'Standing Calf Raise', sets: 3, reps: '10–12', muscle: 'Calves' },
        ],
      },
      {
        name: 'Arms & Weak Points',
        exercises: [
          { name: 'Bayesian Cable Curl', sets: 3, reps: '10–12', muscle: 'Biceps' },
          { name: 'Seated DB French Press', sets: 3, reps: '10', muscle: 'Triceps' },
          { name: 'Constant Tension Preacher Curl', sets: 2, reps: '12–15', muscle: 'Biceps' },
          { name: 'Cable Triceps Kickback', sets: 2, reps: '12–15', muscle: 'Triceps' },
          { name: 'Cable Crunch', sets: 3, reps: '10–12', muscle: 'Core' },
        ],
      },
    ],
  },
];

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find(p => p.id === id);
}
