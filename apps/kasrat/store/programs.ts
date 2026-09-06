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
  /** Unilateral (one side at a time) — reps are per side, volume counts both sides. */
  perSide?: boolean;
  /** Drop set — each working set is followed by lighter drop set(s), no rest between. */
  dropSet?: boolean;
  /** Target RPE (rate of perceived exertion, 6–10). "10" = to failure; compounds keep reps in reserve. */
  rpe?: string;
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
          { name: 'Squat (heavy wk: 4×4 @80% · light wk: 3×6 @75%)', rpe: '7-8', sets: 4, reps: '4 / 6', muscle: 'Quads', note: 'Leave 2–3 reps in the tank — never to failure on heavy compounds (protects the next day). Squat to at least parallel. Cue: screw feet into the floor for a stable base.' },
          { name: 'Incline Dumbbell Press', rpe: '8-9', sets: 3, reps: '8', muscle: 'Chest', perSide: true, note: 'Elbows tucked; bring the dumbbells down & forward, press up & back toward your face for more upper pec.' },
          { name: 'Lying Leg Curl', rpe: '8-9', sets: 3, reps: '10', muscle: 'Hamstrings', note: 'Low-damage hamstring choice — keeps them fresh for Day 2 RDLs.' },
          { name: 'Lat Pulldown', rpe: '8-9', sets: 3, reps: '10', muscle: 'Back', note: 'Vertical pull today; alternate with a horizontal row/face pull across the week.' },
          { name: 'EZ-Bar Biceps Curl (drop set, to failure)', rpe: '10', sets: 3, reps: '12 + 12 drop', muscle: 'Biceps', dropSet: true, note: 'Only lift taken to failure today. Swing the bar out in an arc; drive your pinky up to supinate.' },
          { name: 'Hanging Leg Raise', rpe: '8-9', sets: 3, reps: '12', muscle: 'Core', note: 'Squats barely hit the abs — train them directly. Pair a leg-raise (legs up) with a crunch (torso down) over the week.' },
        ],
      },
      {
        name: 'Day 2 — Chest',
        exercises: [
          { name: 'Bench Press (heavy wk: 3×3 @85% · light wk: 3×5)', rpe: '8', sets: 3, reps: '3 / 5', muscle: 'Chest', note: 'Heavy but not max — external cues over mind-muscle. Squeeze the bar, bend it to tuck elbows, puff the chest, press up & back.' },
          { name: 'Low-to-High Cable Flye', rpe: '9', sets: 3, reps: '15', muscle: 'Chest', perSide: true, note: 'Isolation — push near failure (RPE 9). One side at a time: "hug a tall tree"; palm up at the bottom, down at the top.' },
          { name: 'Romanian Deadlift', rpe: '7-8', sets: 3, reps: '12', muscle: 'Hamstrings', note: 'Stay 2–3 reps shy of failure — big stretch = muscle damage. Hips straight back, stop just below the knees, no lower-back rounding. Keep it light/MMC.' },
          { name: 'Chest-Supported Row', rpe: '8-9', sets: 3, reps: '15', muscle: 'Back', note: 'Chest support spares the lower back. Exaggerate scapular protraction at the bottom → full retraction at the top.' },
          { name: 'Standing Arnold Press', rpe: '8-9', sets: 3, reps: '12', muscle: 'Shoulders', perSide: true, note: 'Standing = more lateral delt. Initiate by sweeping the dumbbells out (rear delt), then press up.' },
          { name: 'Triceps Pressdown', rpe: '9', sets: 3, reps: '15', muscle: 'Triceps', perSide: true, note: 'One arm at a time, weak side first. Let the elbow drift forward at the top to stretch and smash the long head.' },
          { name: 'Smith Machine Shrug', rpe: '8-9', sets: 3, reps: '12–15', muscle: 'Traps', note: 'Lighter load, strong mind-muscle — not a max-weight contest. Wide grip; shrug up & in like lifting your shoulders to your ears.' },
        ],
      },
      {
        name: 'Day 3 — Back',
        exercises: [
          { name: 'Weighted Pull-Up', rpe: '8', sets: 3, reps: '6', muscle: 'Back', note: '3rd back day — warm up thoroughly (RPE 8). Even tempo: rep 6 should look like rep 1; drop weight if form breaks. Stretch lats 20–30s between sets.' },
          { name: 'Cable Row', rpe: '8-9', sets: 3, reps: '10', muscle: 'Back', note: 'Execution over weight — limit momentum, no swinging. Pull elbows back and squeeze the mid-back at the end-range; controlled return to a full stretch.' },
          { name: 'Superset A1: Leg Press', rpe: '8-9', sets: 3, reps: '15', muscle: 'Quads', note: 'Lighter/high-rep — feel the quads. Constant tension, no lockout, 15 smooth non-stop reps. Feet lower = more quad.' },
          { name: 'Superset A2: Standing Calf Raise', rpe: '8-9', sets: 4, reps: '8', muscle: 'Calves', note: 'Knees locked (flex quads). Pause at the bottom of every rep so the Achilles tendon doesn’t take over.' },
          { name: 'Cable Upright Row (Rope)', rpe: '8-9', sets: 3, reps: '10', muscle: 'Shoulders', note: 'Hits side delts + traps. Keep elbows ~80–90° (no higher). Lateral-raise → shrug hybrid: sweep out, then squeeze traps up.' },
          { name: 'Hammer Curl (to failure)', rpe: '10', sets: 3, reps: '10', muscle: 'Biceps', perSide: true, note: 'Taken to failure. Grip the middle of the handle. Hits brachioradialis, brachialis and biceps.' },
        ],
      },
      {
        name: 'Day 4 — Legs (Deadlift)',
        exercises: [
          { name: 'Reset Deadlift (heavy wk: 3×2 · light wk: 3×5 @75%)', rpe: '7-8', sets: 3, reps: '2 / 5', muscle: 'Hamstrings', note: 'Full dead stop & reset on the floor every rep — no bounce/momentum. Sumo favored here (more quad, less lower back) or pick your stronger stance. Cue lats by pulling the bar toward your shins. Linear load increase each week per rep scheme.' },
          { name: 'Weighted Dip', rpe: '8-9', sets: 3, reps: '8', muscle: 'Chest', note: 'Shoulder blades retracted & depressed; ~90° elbow bend. Lean ~30° forward and drive your hands down like a press — hits the whole pec, not just lower.' },
          { name: 'Leg Extension', rpe: '9-10', sets: 3, reps: '20', muscle: 'Quads', note: 'Squeeze the quads to move the weight (and flex on the negative); keep glutes/hams/calves loose. Strong MMC — you may need to stop a bit short once the burn hits.' },
          { name: 'Unilateral Lat Pulldown', rpe: '8-9', sets: 3, reps: '12 / side', muscle: 'Back', perSide: true, note: 'One arm at a time — fixes side-to-side asymmetry and adds loading variety. Pull the elbow down AND in (extension + adduction).' },
          { name: 'Giant Set C1: Rope Face Pull (rear-delt)', rpe: '9', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Rear-delt version: externally rotate and pull the rope to your forehead, like hitting a rear double-biceps pose.' },
          { name: 'Giant Set C2: Cable Overhead Triceps Extension', rpe: '9', sets: 3, reps: '15', muscle: 'Triceps', note: 'Rope, both arms. Let the triceps stretch back at the bottom; squeeze to full elbow lockout. Cable keeps tension constant.' },
          { name: 'Machine Lateral Raise', rpe: '9', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Both arms at once on the machine — the fixed path lets you chase the side delts hard. Lead with the elbows (not the hands), pause at the top, control the way down.' },
        ],
      },
      {
        name: 'Day 5 — Shoulders',
        exercises: [
          { name: 'Barbell Overhead Press (3×6 → +1 set/wk → 5×6, then +load)', rpe: '8', sets: 3, reps: '6', muscle: 'Shoulders', note: 'Progression: 3×6, add a set each week to 5×6 by week 3, then week 4 drop back to 3×6 with more weight. Push through the outside of your hands (cues abduction); elbows ~45° tucked at the bottom, flare as the bar clears your face. Dumbbells fine if comfier.' },
          { name: 'Machine Lateral Raise', rpe: '9-10', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Both arms at once on the machine — the fixed path lets you chase the side delts hard. Lead with the elbows (not the hands), pause at the top, control the way down. Contracted-position loading = low damage, so push close to failure.' },
          { name: 'Seated Cable Row', rpe: '8-9', sets: 3, reps: '12', muscle: 'Back', note: 'Lat-dominant: pull elbows down and tucked to your sides (drop the weight a bit). Lean forward slightly on the eccentric for more lat stretch.' },
          { name: 'Lying Leg Curl', rpe: '8-9', sets: 3, reps: '12', muscle: 'Hamstrings', note: 'Only leg work today. Keep the pads pinned against your ankles — squeeze the hamstrings, don’t heave with momentum. Posterior chain may still be tired from Day 4 deadlifts.' },
          { name: 'Dumbbell Concentration Curl', rpe: '9-10', sets: 3, reps: '12', muscle: 'Biceps', perSide: true, note: 'Elbow pinned to the leg. Supinate by driving through the pinky (neutral at bottom → palm up at top); loose grip so the forearm doesn’t take over.' },
          { name: 'Cable Crunch', rpe: '8-9', sets: 4, reps: '15', muscle: 'Core', note: 'Round the lower back — spinal flexion is the point. Lock shoulders/arms; squeeze the abs together like an accordion, not a hip hinge.' },
          { name: 'Seated Calf Raise', rpe: '9', sets: 4, reps: '15', muscle: 'Calves', note: 'Bent-leg + higher reps for metabolic stress (Day 3 was straight-leg heavy 4×8). Roll over the balls of your feet, pause at the bottom, strong squeeze at the top.' },
          { name: 'Push-Ups (AMRAP, to failure)', rpe: '10', sets: 2, reps: 'Max', muscle: 'Chest', note: 'Max-effort week finisher — rest days follow, so don’t hold back. Nose, chest and stomach all touch the floor each rep. Try to add 1 rep to both sets over the program.' },
        ],
      },
    ],
  },
  // Planet Fitness (Charlotte, Tryon St) — machine-only floor: Smith machine, selectorized
  // machines, dumbbells, cables. No olympic bars, no racks, no lateral-raise machine.
  // Three full-body days so no muscle waits a week and there is no "leg day"; rep ranges
  // undulate across the week (heavy → moderate → metabolic) instead of loads waving by week.
  {
    id: 'pf-fullbody-3d',
    name: 'Lean Full Body',
    author: 'Kasrat',
    split: 'Full Body',
    daysPerCycle: 3,
    description: 'Three full-body sessions a week on a machine-only floor — Smith machine, selectorized machines, dumbbells, cables. Every session trains every major muscle, so nothing is a leg day and a missed session never costs a muscle its whole week. Rep ranges undulate day to day (A heavy 6–8 · B moderate 10–12 · C metabolic 15–20): anything from 5 to 30 reps taken close enough to failure builds muscle, so rotating the range spreads tension across it while keeping joint fatigue low. Volume is held near 10–12 hard sets per muscle per week — the point on the dose-response curve where most of the growth is bought for the least fatigue, which is what you want in a deficit. On keto and cutting, expect load to stall: the job is retention, not PRs. Hold the weight, chase reps, keep protein at 120–165 g/day (1.6–2.2 g/kg), and add walking rather than sets when you want a bigger deficit. Progression is double: hit the top of the rep range on every set, then add the smallest increment and drop back to the bottom. Rest 2–3 min after the first lift, 90–120 s on the machine compounds, 60–90 s on the supersetted pairs — that keeps a session at 75–90 min.',
    days: [
      {
        name: 'Day A — Full Body (Heavy)',
        exercises: [
          { name: 'Smith Machine Squat', rpe: '7-8', sets: 4, reps: '6', muscle: 'Quads', note: 'Leave 2–3 reps in the tank — this is the one lift whose fatigue taxes everything after it. Set your feet slightly ahead of the bar so the fixed rails let you sit down instead of forward; break parallel every rep. No balance demand means the quads, not your stabilisers, end the set.' },
          { name: 'Machine Chest Press', rpe: '8', sets: 3, reps: '8', muscle: 'Chest', note: 'Heaviest press of the week. Seat height so the handles sit level with mid-chest; shoulder blades pinned back and down into the pad. Stop just short of locking out and never let the shoulders roll forward to finish a rep.' },
          { name: 'Lat Pulldown', rpe: '8', sets: 3, reps: '8', muscle: 'Back', note: 'Lean back ~15° and hold that angle — no rocking for momentum. Pull the elbows down and in toward your ribs; let the lats stretch all the way out at the top of every rep.' },
          { name: 'Seated Leg Curl', rpe: '9', sets: 3, reps: '8', muscle: 'Hamstrings', note: 'Seated beats lying here: hip flexion holds the hamstrings in a lengthened position, which grows them faster for the same work. Pad tight on the ankles, no hip lift, control the return. Push this near failure — leg curls are low-fatigue.' },
          { name: 'Machine Shoulder Press', rpe: '8', sets: 3, reps: '8', muscle: 'Shoulders', note: 'Press path just in front of your face, elbows ~45° tucked at the bottom rather than flared to the sides. Ribs down, no lower-back arch to help the last rep.' },
          { name: 'Dumbbell Lateral Raise', rpe: '9', sets: 3, reps: '12', muscle: 'Shoulders', perSide: true, note: 'No lateral machine here — dumbbells, both arms together. Superset with the pressdown below: alternate, rest 90 s after the pair. Lead with the elbows, thumbs a touch down, stop at shoulder height. 10 lb strict beats 20 lb swung.' },
          { name: 'Triceps Pressdown', rpe: '9', sets: 3, reps: '12', muscle: 'Triceps', perSide: true, note: 'One arm at a time, weak side first. Elbow pinned to your side; let it drift a little forward at the top so the long head gets a stretch.' },
          { name: 'EZ-Bar Biceps Curl (drop set, to failure)', rpe: '10', sets: 3, reps: '12 + 12 drop', muscle: 'Biceps', dropSet: true, note: 'The one lift taken to true failure today, then straight to roughly half the load for a second run. Swing the bar out in an arc; drive the pinky up to supinate. Superset with leg raises below.' },
          { name: 'Hanging Leg Raise', rpe: '9', sets: 3, reps: '12', muscle: 'Core', note: 'Curl the pelvis toward your ribs rather than just lifting the legs — the abs flex the spine, they do not raise the thighs. No swinging; if you cannot stop the swing, do them on the captain’s chair.' },
        ],
      },
      {
        name: 'Day B — Full Body (Moderate)',
        exercises: [
          { name: 'Smith Machine Romanian Deadlift', rpe: '8', sets: 3, reps: '10', muscle: 'Hamstrings', note: 'The Smith stands in for the barbell RDL and the fixed path actually makes it easier to stay tight. Hips straight back, bar grazing the thighs, stop just below the knee where the hamstring stretch runs out. Stay 2–3 reps short — the stretch is the stimulus, and a big stretch means muscle damage.' },
          { name: 'Incline Dumbbell Press', rpe: '8-9', sets: 3, reps: '10', muscle: 'Chest', perSide: true, note: 'Elbows tucked; bring the dumbbells down and forward, press up and back toward your face for more upper pec.' },
          { name: 'Chest-Supported Row', rpe: '8-9', sets: 3, reps: '12', muscle: 'Back', note: 'The supported row belongs on the day that opens with the Smith RDL — the pad takes the lower back out of it while the hinge is still fresh in your spine. Exaggerate the protraction at the bottom, then full retraction at the top.' },
          { name: 'Leg Press', rpe: '8-9', sets: 3, reps: '12', muscle: 'Quads', note: 'Feet low and shoulder-width to bias the quads. Constant tension: stop just short of locking the knees and do not let the lower back peel off the pad at the bottom.' },
          { name: 'Reverse Pec Deck', rpe: '9', sets: 3, reps: '15', muscle: 'Shoulders', note: 'Rear delts — the half of the shoulder that squares up your posture, and the half everyone skips. Thumbs pointing back, arms almost straight, drive with the elbows and hold the back position for a beat.' },
          { name: 'Cable Lateral Raise', rpe: '9', sets: 3, reps: '15', muscle: 'Shoulders', perSide: true, note: 'One arm at a time, cable pinned at the bottom of the stack. Worth the extra time over dumbbells because the cable keeps tension at the very start of the raise, where a dumbbell goes slack. Superset with the extension below.' },
          { name: 'Cable Overhead Triceps Extension', rpe: '9', sets: 3, reps: '12', muscle: 'Triceps', note: 'Rope, both arms, torso leaned forward. Overhead puts the long head on stretch — where it grows most — so let the elbows travel well back at the bottom, then squeeze to a full lockout.' },
          { name: 'Cable Curl', rpe: '9', sets: 3, reps: '12', muscle: 'Biceps', note: 'Pulley at the bottom, then take a step past it so your arms hang behind your torso — that is the biceps at full stretch, the hardest and most productive half of the curl, and the reason this is not just another mid-range curl like Day A and Day C. Do not let the elbows drift forward to cheat the bottom. Superset with calves below.' },
          { name: 'Seated Calf Raise', rpe: '9', sets: 3, reps: '15', muscle: 'Calves', note: 'Bent-leg version. Roll all the way over the balls of your feet, pause at the bottom so the Achilles does not take over, strong squeeze at the top.' },
        ],
      },
      {
        name: 'Day C — Full Body (Metabolic)',
        exercises: [
          { name: 'Leg Extension', rpe: '9-10', sets: 3, reps: '20', muscle: 'Quads', note: 'High reps, short rests, burn. Squeeze the quads to move the weight and flex against the negative; when the burn arrives, stop a rep short rather than turning it into a leg swing.' },
          { name: 'Low-to-High Cable Flye', rpe: '9', sets: 3, reps: '15', muscle: 'Chest', perSide: true, note: 'One side at a time: hug a tall tree. Palm up at the bottom, rotating down at the top. Isolation, so take it close to failure.' },
          { name: 'Seated Cable Row', rpe: '9', sets: 3, reps: '15', muscle: 'Back', note: 'No hinge anywhere in this session, so the lower back can hold you upright for the third pull of the week. Execution over load — no swinging from the hips. Full stretch and protraction at the front, elbows back and mid-back squeezed at the end range.' },
          { name: 'Seated Leg Curl', rpe: '9', sets: 3, reps: '15', muscle: 'Hamstrings', note: 'Second curl of the week, lighter and longer. Same lengthened position, but chase the pump rather than the load.' },
          { name: 'Dumbbell Shoulder Press', rpe: '9', sets: 3, reps: '15', muscle: 'Shoulders', perSide: true, note: 'Seated, dumbbells — a different press path from Day A’s machine so the joint gets a break while the delts still work. Sweep the dumbbells out slightly before pressing up.' },
          { name: 'Rope Face Pull', rpe: '9', sets: 3, reps: '20', muscle: 'Shoulders', note: 'Externally rotate and pull the rope to your forehead, like hitting a rear double-biceps pose. First of three lifts run back-to-back at the cable station — rest 60 s after the trio, not between them.' },
          { name: 'Cable Lateral Raise', rpe: '9', sets: 3, reps: '20', muscle: 'Shoulders', perSide: true, note: 'The only day that used to have no direct side-delt work — face pulls are rear delt. One arm at a time, cable pinned at the bottom of the stack. Costs almost nothing inside the giant set, and it means a rushed Day B never leaves the side delts on three sets for the week.' },
          { name: 'Triceps Pressdown', rpe: '9-10', sets: 3, reps: '20', muscle: 'Triceps', perSide: true, note: 'Same lift as Day A, half the load and double the reps. One arm at a time, weak side first; ride the burn out to the last rep.' },
          { name: 'Machine Biceps Curl', rpe: '9-10', sets: 3, reps: '20', muscle: 'Biceps', perSide: true, note: 'One arm at a time. The machine holds the path so you can go right to failure without form breaking down. Superset with the ab machine below.' },
          { name: 'Abdominal Machine', rpe: '9', sets: 3, reps: '20', muscle: 'Core', note: 'Spinal flexion is the point — round down through the ribs, do not hinge at the hips. Squeeze the abs together like an accordion and control the way back.' },
          { name: 'Seated Calf Raise', rpe: '9-10', sets: 3, reps: '20', muscle: 'Calves', note: 'Session finisher. Rest days follow, so empty the tank — pause at the stretch on every rep.' },
        ],
      },
    ],
  },
];

// The program the home screen rotates through. Older programs stay in PROGRAMS so their
// history keeps resolving and they can still be started by hand from the Programs tab.
export const ACTIVE_PROGRAM_ID = 'pf-fullbody-3d';

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

// Sequence of rep targets across a set's "+"-separated phases (for drop sets).
// "12 + 12 drop" → ["12","12"]; "8" → ["8"]; the first entry is the main set, the rest drops.
export function repSequence(reps: string, week: number): string[] {
  return resolveReps(reps, week)
    .split('+')
    .map(chunk => (chunk.match(/\d+/) || [''])[0])
    .filter(Boolean);
}

// Epley 1RM estimate, and inverse — used to project a load from one rep target
// to another (e.g. heavy-wk top set → light-wk working weight for a waved lift).
// Canonical implementations now live in the pure engine; re-exported here so
// existing imports (`@/store/programs`) keep working unchanged.
export { epley1RM, weightForReps } from '@/engine/strength';

// Seed loads (lb) for lifts with no logged history yet — used only when the previous-set
// lookup comes up empty, so an entry goes dead the first time you log that lift. The Nippard
// Day 4/Day 5 seeds are gone: both days are logged, so they resolve from real history now.
// These are the new Planet Fitness lifts, calibrated down from the nearest logged equivalent
// (barbell RDL 130 → Smith 110, Arnold press 25 → DB press 25, cable flye 22.5 → lateral 10).
const STARTER_WEIGHTS: Record<string, number> = {
  'machine chest press': 90,
  'smith machine romanian deadlift': 110,
  'reverse pec deck': 50,
  'cable lateral raise': 10,
  'dumbbell shoulder press': 25,
  'rope face pull': 37.5,
  'leg press': 240,
  'cable overhead triceps extension': 37.5,
};

export function starterWeight(exerciseName: string): number | undefined {
  return STARTER_WEIGHTS[exerciseName.toLowerCase()];
}
