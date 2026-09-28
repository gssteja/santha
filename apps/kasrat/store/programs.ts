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
  /** Sessions a week you plan to train, when it differs from the cycle length (drives the weekly streak). */
  perWeek?: number;
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
  // Jeff Nippard — Ultimate Push Pull Legs (phase 1), adapted to Planet Fitness (Charlotte,
  // Tryon St): Smith machine, selectorized machines, dumbbells, cables — no olympic bar, no
  // racks, no lateral-raise machine. Every barbell lift moves to the Smith machine or dumbbells.
  // Six days rotate off logged history, so a 4-day week just rolls the cycle into the next.
  {
    id: 'nippard-ppl-pf',
    name: 'Ultimate Push Pull Legs',
    author: 'Jeff Nippard',
    split: 'Push / Pull / Legs',
    daysPerCycle: 6,
    perWeek: 4,
    description: 'Two versions of each day (Push 1 → Pull 1 → Legs 1 → Push 2 → Pull 2 → Legs 2), rotated in order however many days you get in. Six a week hits every muscle twice; four rolls the cycle over a week and a half. Strength work is kept to the minimum that still progresses: one hard top set on the big lift (RPE 8–9, never a grinder you can’t repeat), then lighter back-off sets of a variation. Everything after that is bodybuilding work with a twist: set-to-set grip and angle changes, lengthened partials, and 30 s loaded stretches between sets. Barbell lifts run on the Smith machine or dumbbells here. On a cut, the top sets will stall before the pump work does. Hold the load, chase reps, and treat a matched top set as a win.',
    days: [
      {
        name: 'Push 1 — Flat Press',
        exercises: [
          { name: 'Smith Machine Bench Press', rpe: '9', sets: 1, reps: '3–5', muscle: 'Chest', note: 'One top set after a full warm-up pyramid. Dig the upper back in, pin the shoulder blades down and back, butt and head on the bench. Touch the highest point of the chest; anywhere from 0–30° of elbow tuck is fine. The last rep should grind, with maybe one left in the tank.' },
          { name: 'Smith Machine Larsen Press', rpe: '8', sets: 2, reps: '10', muscle: 'Chest', note: '~75% of the top set. Legs straight out on the bench, so there is no leg drive and the pecs, front delts and triceps do all of it. Grip a touch closer than the top set. 1–2 s down, 1–2 s up, soft touch on the chest.' },
          { name: 'Standing Arnold Press', rpe: '8-9', sets: 3, reps: '8–10', muscle: 'Shoulders', perSide: true, note: 'Start palms in, flare the elbows out as you press to a full lockout, then reverse under control. Treat it like an overhead press: squeeze the glutes, drive through the heels, and add load over time. A belt and straps help if you have them.' },
          { name: 'Cable Press-Around', rpe: '9', sets: 2, reps: '12–15', muscle: 'Chest', perSide: true, note: 'One arm. Half fly, half press: drive the handle around and past your midline. Almost no other pec exercise gets that end-range squeeze. After each side, hold a static pec stretch for 30 s at about a 7/10 before switching arms.' },
          { name: 'Cross-Body Cable Y-Raise', rpe: '9', sets: 3, reps: '12–15', muscle: 'Shoulders', perSide: true, note: 'Handle starts across your body, like drawing a sword, which stretches the side delt further than a lateral raise can. Flick it up and out on a diagonal. It is not a front raise; the path goes out and back.' },
          { name: 'Squeeze-Only Triceps Pressdown', rpe: '9-10', sets: 3, reps: '8', muscle: 'Triceps', note: 'Bottom half only, elbows pinned: go from 90° to full lockout. That is where a pressdown is hardest. Superset straight into the stretch-only overhead extension below, no rest between.' },
          { name: 'Stretch-Only Overhead Triceps Extension', rpe: '9-10', sets: 3, reps: '8', muscle: 'Triceps', note: 'Cable, rope, facing away. Bottom half only: sink deep into the stretch, then press back just to 90°. The pressdown handles the squeeze and this handles the long-head stretch. Rest after the pair.' },
          { name: 'Cross-Body Cable Triceps Extension', rpe: '9', sets: 2, reps: '10–12', muscle: 'Triceps', perSide: true, note: 'Cable at shoulder height, arm flared out to the side and extending across the body. The long head crosses the shoulder too, so a new arm angle hits the triceps differently from the tucked-elbow work.' },
        ],
      },
      {
        name: 'Pull 1 — Pulldown',
        exercises: [
          { name: 'Lat Pulldown', rpe: '10', sets: 2, reps: '10', muscle: 'Back', note: 'Do 4 feeder sets of 10 first (RPE 4–5, 6–7, 7–8, then pick the working weight from how the third felt). Then 2 sets to failure at the same weight; the second usually lands at 7–8. After the second set, strip ~30% and grind out 4–5 more. Keep a middle overhand grip, 1–1.5× shoulder width. Wear straps or use a thumbless grip. A little lean and rock is fine if the negative stays controlled.' },
          { name: 'Chest-Supported Row', rpe: '9', sets: 3, reps: '10–12', muscle: 'Back', note: 'Omni-grip: wide on set 1, a bit closer on set 2, neutral or underhand on set 3. The back is a web of muscles pulling at different angles, so change the angle. Squeeze the shoulder blades together at the top.' },
          { name: 'Dumbbell Pullover (bottom half)', rpe: '9', sets: 2, reps: '10–12', muscle: 'Back', note: 'Stretch half only. The lats go slack at the top, so turn around at about eye level. After each set, grab a post and sit the hips back for a 30 s lat stretch on each side, then rest 30 s. Switch which side you stretch first on set 2.' },
          { name: 'Rope Face Pull', rpe: '9', sets: 3, reps: '12–15', muscle: 'Shoulders', note: 'Omni-direction: pulley low (pull low → high) on set 1, shoulder height on set 2, high (pull down toward the eyes) on set 3.' },
          { name: 'Dumbbell Curl', rpe: '8-9', sets: 3, reps: '6–8', muscle: 'Biceps', perSide: true, note: 'The heavy curl of the week, standing in for the EZ-bar curl. Track load and reps like a main lift, and add one of them every week. A little hip drive to start the rep is fine if every negative is controlled.' },
          { name: 'Machine Preacher Curl (bottom half)', rpe: '10', sets: 2, reps: '10–12', muscle: 'Biceps', perSide: true, note: 'Stretched half only: from full extension up to about 90°. In a 2021 study, bottom-half preacher curls grew the biceps more than twice as much as top-half ones. One arm at a time, weak side first, then match the reps on the strong side.' },
        ],
      },
      {
        name: 'Legs 1 — Squat',
        exercises: [
          { name: 'Smith Machine Squat', rpe: '8-9', sets: 1, reps: '4–6', muscle: 'Quads', note: 'One top set at 85–90% after 4–5 warm-up sets, leaving 1–2 reps in the tank. Jeff’s hypertrophy option runs 4–6 instead of 2–4. Feet slightly ahead of the bar so you sit down rather than forward, and break parallel on every rep.' },
          { name: 'Smith Machine Paused Squat', rpe: '8', sets: 2, reps: '5', muscle: 'Quads', note: '~75% of the top set. Big breath at the top, sit down between the knees, and hold it through a 1–2 s pause in the hole, then drive up hard. The pause kills the stretch reflex, so light weight still works the quads and glutes hard, and every rep hits depth.' },
          { name: 'Smith Machine Romanian Deadlift', rpe: '8', sets: 3, reps: '8–10', muscle: 'Hamstrings', note: 'Hips straight back, bar tight to the legs, shins near vertical. Turn around between just below the knee and mid-shin, before the lower back rounds. For more hamstring, cut the top 10–25% and pause at the bottom. For more glute, drive the hips through at the top.' },
          { name: 'Dumbbell Walking Lunge', rpe: '9', sets: 2, reps: '10 / side', muscle: 'Quads', perSide: true, note: 'That’s 20 strides a set. The back knee kisses the floor on every rep, including the last ones. Control the way down instead of dropping into it. Strap in if your grip gives out before your legs.' },
          { name: 'Seated Leg Curl', rpe: '9', sets: 3, reps: '10–12', muscle: 'Hamstrings', note: 'Seated leg curls grew the hamstrings ~56% more than lying ones in a 12-week study, because the flexed hip loads them at a longer length. Sit forward enough to feel a stretch before rep one. Toes slightly out on set 1, in on set 2, straight on set 3.' },
          { name: 'Leg Press Calf Raise', rpe: '9', sets: 4, reps: '10–12', muscle: 'Calves', note: 'Toes out on set 1 (inner calf), in on set 2 (outer calf), straight on sets 3–4. Unlike the leg curl cue, this one has a training study behind it. Full stretch at the bottom, no bouncing.' },
          { name: 'Cable Crunch', rpe: '9', sets: 3, reps: '10–12', muscle: 'Core', note: 'Stands in for the decline plate crunch. Round the spine and squeeze the six-pack together; don’t hinge at the hips, which just trains the hip flexors. Track the load and add a rep or some weight each session.' },
        ],
      },
      {
        name: 'Push 2 — Incline Press',
        exercises: [
          { name: 'Smith Machine Incline Press', rpe: '8-9', sets: 3, reps: '8 · 5 · 15', muscle: 'Chest', note: 'Undulating sets: 8 reps at moderate load to find the groove, then 5 heavier, then 15 light for the pump. Rest 3–4 min before the set of 5. Grip just outside shoulder width, touch high on the chest, and keep the bar stacked over the shoulder. Incline grew the upper pecs more than flat did, with no loss lower down.' },
          { name: 'Machine Shoulder Press', rpe: '9', sets: 3, reps: '10–12', muscle: 'Shoulders', note: 'Seat low enough that the elbows break parallel. Thumbless grip, constant tension: no lockout at the top, 1 s up and 1 s down. Leave 1 in the tank on sets 1–2 and take set 3 to failure.' },
          { name: 'Dumbbell Skull Crusher (floor reset)', rpe: '8-9', sets: 3, reps: '6–8', muscle: 'Triceps', perSide: true, note: 'The strength-focused triceps lift. Lie on the floor, lower under control to about halfway, then let the dumbbells settle to a dead stop on the floor behind your head and press from there. Go heavier than a normal skull crusher and log it like a main lift.' },
          { name: 'Bent-Over Cable Fly', rpe: '9', sets: 3, reps: '10–12', muscle: 'Chest', note: 'Pulleys at shoulder height. Hinge forward at the hips and fly straight down in front of you. Leaning over the cables keeps them from pulling you backward, so your balance isn’t limiting the pecs. Hits the whole chest, mostly the mid pecs.' },
          { name: 'Dumbbell Lateral Raise', rpe: '9-10', sets: 3, reps: '20', muscle: 'Shoulders', perSide: true, note: 'No lateral machine here, so use dumbbells. Make the first 5 reps 5 s negatives to find the side delt, then do 15 constant-tension reps (1 s up, 1 s down, no pause at either end). Lead with the elbows.' },
          { name: 'Plate Front Raise', rpe: '9', sets: 2, reps: '15–20', muscle: 'Shoulders', note: 'Steer the wheel: rotate the plate inward as it rises. Internal rotation brings the side-delt fibers in, so this is less of a pure front-delt lift. If it bothers the shoulder, swap in a dumbbell Y-raise.' },
          { name: 'Diamond Push-Up', rpe: '10', sets: 1, reps: 'Max', muscle: 'Triceps', note: 'One all-out AMRAP to finish, since nothing comes after it. Hands form a diamond under the chest to load the triceps. Control the lowering instead of dropping, and keep the form strict all the way to failure.' },
        ],
      },
      {
        name: 'Pull 2 — One-Arm Pulldown',
        exercises: [
          { name: 'Unilateral Lat Pulldown', rpe: '9', sets: 3, reps: '12–15', muscle: 'Back', perSide: true, note: 'Half-kneeling at a cable, free hand braced on the same-side knee. Keep the forearm in line with the cable, and stop with the elbow at your side, because the lats lose leverage once the arm passes the torso.' },
          { name: 'Pull-Up', rpe: '10', sets: 1, reps: 'Max', muscle: 'Back', note: 'One all-out AMRAP. Use the assisted machine if you need it, and log the assistance as negative weight. Grip 1.5× shoulder width, chest up, elbows down and in, chin over the bar. Match last week’s reps if you’re bulking. On a cut, add a rep a week, since you’re moving less bodyweight.' },
          { name: 'Kroc Row', rpe: '9-10', sets: 3, reps: '10–12', muscle: 'Back', perSide: true, note: 'A looser dumbbell row, torso more upright, with a little controlled body English. A back exercise is easy at the bottom and hardest at the top, so some momentum off the bottom lets you reach real failure. Control every negative.' },
          { name: 'Cable Shrug', rpe: '9', sets: 3, reps: '10–12', muscle: 'Traps', note: 'Stand between two low pulleys. The upper-trap fibers fan out horizontally, so shrug up and in toward the ears, not straight up.' },
          { name: 'Reverse Pec Deck', rpe: '9', sets: 3, reps: '10–12', muscle: 'Shoulders', note: 'Sweep out and back, not just back; pulling straight back hands the work to the mid traps. Palms facing on set 1, palms down on set 2, slightly internally rotated on set 3. Rear-delt feel varies a lot from person to person, so find your grip.' },
          { name: 'Overhead Cable Curl', rpe: '9', sets: 3, reps: '10–12', muscle: 'Biceps', perSide: true, note: 'Kneel, with the arm up and out to the side at a high pulley. Arm-overhead positions seem to bias the long head (the peak). If you want more biceps volume, add a couple of sets with the arm down at your side or behind you.' },
        ],
      },
      {
        name: 'Legs 2 — Hip Thrust',
        exercises: [
          { name: 'Smith Machine Hip Thrust', rpe: '8-9', sets: 1, reps: '5–8', muscle: 'Glutes', note: 'Stands in for the deadlift top set; hip thrust is Jeff’s glute-dominant swap. Upper back on the bench, bar across the hips on a pad, chin tucked. Drive to full hip lockout and squeeze. Leave 1–2 in the tank and add load week to week.' },
          { name: 'Dumbbell Stiff-Leg Deadlift', rpe: '7-8', sets: 2, reps: '8', muscle: 'Hamstrings', perSide: true, note: 'The back-off pulls. Hips high, knees nearly straight, and hinge to start the pull, not a squat. Dumbbells reach the floor where the Smith can’t. Start light and stay shy of failure until the pattern feels natural.' },
          { name: 'Leg Press', rpe: '9', sets: 4, reps: '10–12', muscle: 'Quads', note: 'The quad work after a hinge-heavy start. Medium stance, as deep as you can go before the lower back peels off the pad. Soft knees at the top and no pauses, so tension stays constant. Cap rest at 2 min to keep the session moving.' },
          { name: 'Lying Leg Curl', rpe: '9', sets: 3, reps: '8–10', muscle: 'Hamstrings', note: 'Stands in for the glute-ham raise. Skip the top quarter, where there’s no tension. Pads tight, hips down, control the return. If there’s no lying curl free, use the seated curl.' },
          { name: 'Leg Extension', rpe: '9', sets: 3, reps: '8–10', muscle: 'Quads', note: '3 s negative on every rep. Leg extensions are the only lift that fully contracts the rectus femoris, which crosses the hip too. The slow eccentric makes a lighter load feel heavy, which is easier on the knees.' },
          { name: 'Seated Calf Raise', rpe: '9', sets: 4, reps: '15–20', muscle: 'Calves', note: 'The bent-knee calf lift, paired with the straight-leg one on Legs 1. Roll over the balls of your feet, pause in the stretch, squeeze at the top. No seated machine free? Do leg press calf raises.' },
          { name: 'Captain’s Chair Leg Raise', rpe: '9', sets: 3, reps: '10–20', muscle: 'Core', note: 'Curl the lower back and bring the knees or legs up to chest height; the abs do the work, not the hip flexors. Stop the set when you need to swing. Bend the knees if straight legs won’t reach 10. If 20 is easy, take 2–3 s on the way down.' },
        ],
      },
    ],
  },
];

// The program the home screen rotates through. Older programs stay in PROGRAMS so their
// history keeps resolving and they can still be started by hand from the Programs tab.
export const ACTIVE_PROGRAM_ID = 'nippard-ppl-pf';

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
// lookup comes up empty, so an entry goes dead the first time you log that lift. These are
// the PPL lifts new to the log, calibrated from the nearest logged equivalent (Smith squat
// 100 → paused 75, machine chest press 110 → Smith bench 100, hammer curl 22.5 → heavy DB
// curl 25, machine curl 60 → bottom-half preacher 50, face pull 25 → Y-raise 10).
const STARTER_WEIGHTS: Record<string, number> = {
  'smith machine bench press': 100,
  'smith machine larsen press': 75,
  'cable press-around': 20,
  'cross-body cable y-raise': 10,
  'squeeze-only triceps pressdown': 40,
  'stretch-only overhead triceps extension': 30,
  'cross-body cable triceps extension': 15,
  'dumbbell pullover (bottom half)': 35,
  'dumbbell curl': 25,
  'machine preacher curl (bottom half)': 50,
  'smith machine paused squat': 75,
  'dumbbell walking lunge': 25,
  'smith machine incline press': 80,
  'dumbbell skull crusher (floor reset)': 20,
  'bent-over cable fly': 20,
  'plate front raise': 25,
  'kroc row': 50,
  'cable shrug': 60,
  'overhead cable curl': 20,
  'smith machine hip thrust': 135,
  'dumbbell stiff-leg deadlift': 40,
};

export function starterWeight(exerciseName: string): number | undefined {
  return STARTER_WEIGHTS[exerciseName.toLowerCase()];
}
