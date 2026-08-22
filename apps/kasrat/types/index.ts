export type WorkoutSet = {
  weight: string;
  reps: string;
  done: boolean;
  /** Part of a drop set — done immediately after the prior set at a lighter weight (no rest). */
  drop?: boolean;
};

export type WorkoutExercise = {
  exId: string;
  name: string;
  muscle: string;
  sets: WorkoutSet[];
  /** Unilateral lift — reps are per side; volume counts both sides (×2). */
  perSide?: boolean;
  /** Prescribed target for this session, e.g. "4×4" — shown in the workout screen. */
  target?: string;
  /** True when this exercise waves and the current week is the heavy phase. */
  heavy?: boolean;
  /** Whether this exercise undulates heavy/light by week (drives the HEAVY/LIGHT chip). */
  waved?: boolean;
  /** Coaching cue from the program, shown under the exercise during the workout. */
  note?: string;
  /** Target RPE from the program (e.g. "8", "7-8", "10"), shown as a chip. */
  rpe?: string;
};

export type ActiveWorkout = {
  id: string;
  name: string;
  startTime: number;
  exercises: WorkoutExercise[];
  /** Program week this session belongs to (carried from the history-derived "next up"). */
  week?: number;
  /** Program this session came from. Absent on ad-hoc workouts and on anything logged
   *  before programs were tagged (those are all Nippard high-frequency sessions). */
  programId?: string;
};

export type WorkoutRecord = {
  id: string;
  name: string;
  date: string;
  duration: number;
  sets: number;
  volume: number;
  /** Program week this was logged in — used to pull phase-matched (heavy/light) previous weights. */
  week?: number;
  /** Program this session belongs to — keeps one program's rotation and week count from
   *  being advanced by another program's sessions. Untagged records predate the field. */
  programId?: string;
  exercises: string[];
  exerciseData?: {
    name: string;
    muscle: string;
    sets: WorkoutSet[];
    perSide?: boolean;
  }[];
};

export type Exercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
};
