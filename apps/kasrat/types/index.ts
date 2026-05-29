export type WorkoutSet = {
  weight: string;
  reps: string;
  done: boolean;
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
};

export type ActiveWorkout = {
  id: string;
  name: string;
  startTime: number;
  exercises: WorkoutExercise[];
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
