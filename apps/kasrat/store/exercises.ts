import type { Exercise } from '@/types';

export const EXERCISES: Exercise[] = [
  // Chest
  { id: 'bench', name: 'Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'incline-bench', name: 'Incline Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'db-fly', name: 'Dumbbell Fly', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'cable-fly', name: 'Cable Fly', muscle: 'Chest', equipment: 'Cable' },
  { id: 'pushup', name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight' },
  // Back
  { id: 'deadlift', name: 'Deadlift', muscle: 'Back', equipment: 'Barbell' },
  { id: 'pullup', name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight' },
  { id: 'row-barbell', name: 'Barbell Row', muscle: 'Back', equipment: 'Barbell' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'seated-row', name: 'Seated Cable Row', muscle: 'Back', equipment: 'Cable' },
  { id: 'db-row', name: 'Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell' },
  // Shoulders
  { id: 'ohp', name: 'Overhead Press', muscle: 'Shoulders', equipment: 'Barbell' },
  { id: 'db-lateral', name: 'Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'face-pull', name: 'Face Pull', muscle: 'Shoulders', equipment: 'Cable' },
  { id: 'db-shoulder-press', name: 'DB Shoulder Press', muscle: 'Shoulders', equipment: 'Dumbbell' },
  // Biceps
  { id: 'curl', name: 'Barbell Curl', muscle: 'Biceps', equipment: 'Barbell' },
  { id: 'db-curl', name: 'Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell' },
  { id: 'cable-curl', name: 'Cable Curl', muscle: 'Biceps', equipment: 'Cable' },
  // Triceps
  { id: 'tricep-push', name: 'Tricep Pushdown', muscle: 'Triceps', equipment: 'Cable' },
  { id: 'skull-crusher', name: 'Skull Crusher', muscle: 'Triceps', equipment: 'Barbell' },
  { id: 'dip', name: 'Dip', muscle: 'Triceps', equipment: 'Bodyweight' },
  // Quads
  { id: 'squat', name: 'Back Squat', muscle: 'Quads', equipment: 'Barbell' },
  { id: 'front-squat', name: 'Front Squat', muscle: 'Quads', equipment: 'Barbell' },
  { id: 'leg-press', name: 'Leg Press', muscle: 'Quads', equipment: 'Machine' },
  { id: 'leg-ext', name: 'Leg Extension', muscle: 'Quads', equipment: 'Machine' },
  // Hamstrings
  { id: 'rdl', name: 'Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Barbell' },
  { id: 'leg-curl', name: 'Leg Curl', muscle: 'Hamstrings', equipment: 'Machine' },
  // Glutes
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Glutes', equipment: 'Barbell' },
  { id: 'glute-bridge', name: 'Glute Bridge', muscle: 'Glutes', equipment: 'Bodyweight' },
  // Calves
  { id: 'calf-raise', name: 'Calf Raise', muscle: 'Calves', equipment: 'Machine' },
  { id: 'standing-calf', name: 'Standing Calf Raise', muscle: 'Calves', equipment: 'Barbell' },
  // Core
  { id: 'plank', name: 'Plank', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'crunch', name: 'Crunch', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'ab-rollout', name: 'Ab Rollout', muscle: 'Core', equipment: 'Other' },
];

export const MUSCLES = [...new Set(EXERCISES.map(e => e.muscle))];

export function getExercise(id: string): Exercise | undefined {
  return EXERCISES.find(e => e.id === id);
}
