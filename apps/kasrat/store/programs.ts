// Jeff Nippard — High-Frequency Full-Body split ("Full Body Science Applied" series).
// Five full-body days, each with a different muscle focus; every body part hit each session.
// Notes capture Jeff's key cues/guidelines per exercise.
//
// Squat (Day 1) and Bench (Day 2) run a weekly-undulating wave: a heavy/low-rep week alternates
// with a lighter/higher-rep week, adding load on the heavy weeks. Keep reps in reserve on heavy
// compounds — going to failure hurts recovery on a high-frequency split.

export type ProgramExercise = {
  name: string;
  sets: number;
  reps: string;
  muscle?: string;
  note?: string;
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
    description: 'Five full-body days a week, each with a different focus. Heavy compounds (squat, bench) wave weekly — a heavy low-rep week alternates with a lighter higher-rep week, adding load on the heavy weeks. Leave reps in reserve on compounds; push isolation work harder.',
    days: [
      {
        name: 'Day 1 — Legs (Squat)',
        exercises: [
          { name: 'Squat (heavy wk: 4×4 @80% · light wk: 3×6 @75%)', sets: 4, reps: '4 / 6', muscle: 'Quads', note: 'Leave 2–3 reps in the tank — never to failure on heavy compounds (protects the next day). Squat to at least parallel. Cue: screw feet into the floor for a stable base.' },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '8', muscle: 'Chest', note: 'Elbows tucked; bring the dumbbells down & forward, press up & back toward your face for more upper pec.' },
          { name: 'Lying Leg Curl', sets: 3, reps: '10', muscle: 'Hamstrings', note: 'Low-damage hamstring choice — keeps them fresh for Day 2 RDLs.' },
          { name: 'Lat Pulldown', sets: 3, reps: '10', muscle: 'Back', note: 'Vertical pull today; alternate with a horizontal row/face pull across the week.' },
          { name: 'EZ-Bar Biceps Curl (drop set, to failure)', sets: 3, reps: '12 + 12 drop', muscle: 'Biceps', note: 'Only lift taken to failure today. Swing the bar out in an arc; drive your pinky up to supinate.' },
          { name: 'Hanging Leg Raise', sets: 3, reps: '12', muscle: 'Core', note: 'Squats barely hit the abs — train them directly. Pair a leg-raise (legs up) with a crunch (torso down) over the week.' },
        ],
      },
      {
        name: 'Day 2 — Chest',
        exercises: [
          { name: 'Bench Press (heavy wk: 3×3 @85% · light wk: 3×5)', sets: 3, reps: '3 / 5', muscle: 'Chest', note: 'Heavy but not max — external cues over mind-muscle. Squeeze the bar, bend it to tuck elbows, puff the chest, press up & back.' },
          { name: 'Low-to-High Cable Flye', sets: 3, reps: '15', muscle: 'Chest', note: 'Isolation — push near failure (RPE 9). "Hug a tall tree"; palms up at the bottom, down at the top.' },
          { name: 'Romanian Deadlift', sets: 3, reps: '12', muscle: 'Hamstrings', note: 'Stay 2–3 reps shy of failure — big stretch = muscle damage. Hips straight back, stop just below the knees, no lower-back rounding. Keep it light/MMC.' },
          { name: 'Chest-Supported Row', sets: 3, reps: '15', muscle: 'Back', note: 'Chest support spares the lower back. Exaggerate scapular protraction at the bottom → full retraction at the top.' },
          { name: 'Standing Arnold Press', sets: 3, reps: '12', muscle: 'Shoulders', note: 'Standing = more lateral delt. Initiate by sweeping the dumbbells out (rear delt), then press up.' },
          { name: 'Triceps Pressdown', sets: 3, reps: '15', muscle: 'Triceps', note: 'One arm at a time, weak side first. Let the elbow drift forward at the top to stretch and smash the long head.' },
          { name: 'Smith Machine Shrug', sets: 3, reps: '12–15', muscle: 'Traps', note: 'Lighter load, strong mind-muscle — not a max-weight contest. Wide grip; shrug up & in like lifting your shoulders to your ears.' },
        ],
      },
      {
        name: 'Day 3 — Back',
        exercises: [
          { name: 'Weighted Pull-Up', sets: 3, reps: '6', muscle: 'Back', note: '3rd back day — warm up thoroughly (RPE 8). Even tempo: rep 6 should look like rep 1; drop weight if form breaks. Stretch lats 20–30s between sets.' },
          { name: 'Bent-Over Row', sets: 3, reps: '10', muscle: 'Back', note: 'Execution over weight — limit momentum, no swinging. Set torso ~parallel to the floor.' },
          { name: 'Superset A1: Leg Press', sets: 3, reps: '15', muscle: 'Quads', note: 'Lighter/high-rep — feel the quads. Constant tension, no lockout, 15 smooth non-stop reps. Feet lower = more quad.' },
          { name: 'Superset A2: Standing Calf Raise', sets: 4, reps: '8', muscle: 'Calves', note: 'Knees locked (flex quads). Pause at the bottom of every rep so the Achilles tendon doesn’t take over.' },
          { name: 'Cable Upright Row (Rope)', sets: 3, reps: '10', muscle: 'Shoulders', note: 'Hits side delts + traps. Keep elbows ~80–90° (no higher). Lateral-raise → shrug hybrid: sweep out, then squeeze traps up.' },
          { name: 'Hammer Curl (to failure)', sets: 3, reps: '10', muscle: 'Biceps', note: 'Taken to failure. Grip the middle of the handle. Hits brachioradialis, brachialis and biceps.' },
        ],
      },
      {
        name: 'Day 4 — Legs (Deadlift)',
        exercises: [
          { name: 'Reset Deadlift (wk A: 3×5 @75% · wk B: 3×2 heavy)', sets: 3, reps: '5 / 2', muscle: 'Hamstrings', note: 'Full dead stop & reset on the floor every rep — no bounce/momentum. Sumo favored here (more quad, less lower back) or pick your stronger stance. Cue lats by pulling the bar toward your shins. Linear load increase each week per rep scheme.' },
          { name: 'Weighted Dip', sets: 3, reps: '8', muscle: 'Chest', note: 'Shoulder blades retracted & depressed; ~90° elbow bend. Lean ~30° forward and drive your hands down like a press — hits the whole pec, not just lower.' },
          { name: 'Leg Extension', sets: 3, reps: '20', muscle: 'Quads', note: 'Squeeze the quads to move the weight (and flex on the negative); keep glutes/hams/calves loose. Strong MMC — you may need to stop a bit short once the burn hits.' },
          { name: 'Unilateral Lat Pulldown', sets: 3, reps: '12 / side', muscle: 'Back', note: 'One arm at a time — fixes side-to-side asymmetry and adds loading variety. Pull the elbow down AND in (extension + adduction).' },
          { name: 'Giant Set C1: Rope Face Pull (rear-delt)', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Rear-delt version: externally rotate and pull the rope to your forehead, like hitting a rear double-biceps pose.' },
          { name: 'Giant Set C2: Cable Overhead Triceps Extension', sets: 3, reps: '15', muscle: 'Triceps', note: 'Rope, both arms. Let the triceps stretch back at the bottom; squeeze to full elbow lockout. Cable keeps tension constant.' },
          { name: 'Giant Set C3: Egyptian Lateral Raise', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Cable between the legs for constant tension; let it travel down for a deep stretch on the side delt.' },
        ],
      },
      {
        name: 'Day 5 — Shoulders',
        exercises: [
          { name: 'Barbell Overhead Press (3×6 → +1 set/wk → 5×6, then +load)', sets: 3, reps: '6', muscle: 'Shoulders', note: 'Progression: 3×6, add a set each week to 5×6 by week 3, then week 4 drop back to 3×6 with more weight. Push through the outside of your hands (cues abduction); elbows ~45° tucked at the bottom, flare as the bar clears your face. Dumbbells fine if comfier.' },
          { name: 'Dumbbell Lateral Raise', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Contracted-position loading = low muscle damage, so push close to failure. (Day 4 used the stretch-loaded cable version — alternated on purpose.)' },
          { name: 'Seated Cable Row', sets: 3, reps: '12', muscle: 'Back', note: 'Lat-dominant: pull elbows down and tucked to your sides (drop the weight a bit). Lean forward slightly on the eccentric for more lat stretch.' },
          { name: 'Lying Leg Curl', sets: 3, reps: '12', muscle: 'Hamstrings', note: 'Only leg work today. Keep the pads pinned against your ankles — squeeze the hamstrings, don’t heave with momentum. Posterior chain may still be tired from Day 4 deadlifts.' },
          { name: 'Dumbbell Concentration Curl', sets: 3, reps: '12', muscle: 'Biceps', note: 'Elbow pinned to the leg. Supinate by driving through the pinky (neutral at bottom → palm up at top); loose grip so the forearm doesn’t take over.' },
          { name: 'Cable Crunch', sets: 4, reps: '15', muscle: 'Core', note: 'Round the lower back — spinal flexion is the point. Lock shoulders/arms; squeeze the abs together like an accordion, not a hip hinge.' },
          { name: 'Seated Calf Raise', sets: 4, reps: '15', muscle: 'Calves', note: 'Bent-leg + higher reps for metabolic stress (Day 3 was straight-leg heavy 4×8). Roll over the balls of your feet, pause at the bottom, strong squeeze at the top.' },
          { name: 'Push-Ups (AMRAP, to failure)', sets: 2, reps: 'Max', muscle: 'Chest', note: 'Max-effort week finisher — rest days follow, so don’t hold back. Nose, chest and stomach all touch the floor each rep. Try to add 1 rep to both sets over the program.' },
        ],
      },
    ],
  },
];

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find(p => p.id === id);
}

// Weekly undulating wave: odd weeks are heavy (low rep), even weeks are light (higher rep).
export function isHeavyWeek(week: number): boolean {
  return week % 2 === 1;
}

// A waved exercise encodes "heavy / light" in its reps field, e.g. "4 / 6".
// Only treat a bare "N / M" (both numeric) as a wave — NOT per-side notation
// like "15 / side" or "12 / side", which would otherwise resolve to "side" → blank.
export function isWaved(reps: string): boolean {
  return /^\s*\d+\s*\/\s*\d+\s*$/.test(reps);
}

// Resolve a (possibly waved) reps string to the target for the given week.
export function resolveReps(reps: string, week: number): string {
  if (!isWaved(reps)) return reps;
  const [heavy, light] = reps.split('/').map(s => s.trim());
  return isHeavyWeek(week) ? heavy : light;
}

// First integer of a resolved reps string, for prefilling the numeric reps input.
// "12–15"→"12", "12 + 12 drop"→"12", "15 / side"→"15", "Max"→"" (no number).
export function repsToInput(reps: string, week: number): string {
  const m = resolveReps(reps, week).match(/\d+/);
  return m ? m[0] : '';
}
