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
  exercises: string[];
  exerciseData?: {
    name: string;
    muscle: string;
    sets: WorkoutSet[];
  }[];
};

export type Exercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
};
