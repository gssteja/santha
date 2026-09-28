import type { Exercise } from '@/types';

export const EXERCISES: Exercise[] = [
  // Chest
  { id: 'bench', name: 'Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'incline-bench', name: 'Incline Bench Press', muscle: 'Chest', equipment: 'Barbell' },
  { id: 'db-fly', name: 'Dumbbell Fly', muscle: 'Chest', equipment: 'Dumbbell' },
  { id: 'cable-fly', name: 'Cable Fly', muscle: 'Chest', equipment: 'Cable' },
  { id: 'pushup', name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', muscle: 'Chest', equipment: 'Machine' },
  { id: 'low-high-cable-flye', name: 'Low-to-High Cable Flye', muscle: 'Chest', equipment: 'Cable' },
  { id: 'smith-bench', name: 'Smith Machine Bench Press', muscle: 'Chest', equipment: 'Machine' },
  { id: 'smith-incline', name: 'Smith Machine Incline Press', muscle: 'Chest', equipment: 'Machine' },
  { id: 'cable-press-around', name: 'Cable Press-Around', muscle: 'Chest', equipment: 'Cable' },
  { id: 'bent-over-cable-fly', name: 'Bent-Over Cable Fly', muscle: 'Chest', equipment: 'Cable' },
  // Back
  { id: 'deadlift', name: 'Deadlift', muscle: 'Back', equipment: 'Barbell' },
  { id: 'pullup', name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight' },
  { id: 'row-barbell', name: 'Barbell Row', muscle: 'Back', equipment: 'Barbell' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: 'Cable' },
  { id: 'seated-row', name: 'Seated Cable Row', muscle: 'Back', equipment: 'Cable' },
  { id: 'db-row', name: 'Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell' },
  { id: 'chest-supported-row', name: 'Chest-Supported Row', muscle: 'Back', equipment: 'Machine' },
  { id: 'kroc-row', name: 'Kroc Row', muscle: 'Back', equipment: 'Dumbbell' },
  { id: 'db-pullover', name: 'Dumbbell Pullover', muscle: 'Back', equipment: 'Dumbbell' },
  { id: 'cable-shrug', name: 'Cable Shrug', muscle: 'Back', equipment: 'Cable' },
  // Shoulders
  { id: 'ohp', name: 'Overhead Press', muscle: 'Shoulders', equipment: 'Barbell' },
  { id: 'db-lateral', name: 'Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'machine-lateral', name: 'Machine Lateral Raise', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'face-pull', name: 'Face Pull', muscle: 'Shoulders', equipment: 'Cable' },
  { id: 'db-shoulder-press', name: 'DB Shoulder Press', muscle: 'Shoulders', equipment: 'Dumbbell' },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'cable-lateral', name: 'Cable Lateral Raise', muscle: 'Shoulders', equipment: 'Cable' },
  { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', muscle: 'Shoulders', equipment: 'Machine' },
  { id: 'cable-y-raise', name: 'Cross-Body Cable Y-Raise', muscle: 'Shoulders', equipment: 'Cable' },
  { id: 'plate-front-raise', name: 'Plate Front Raise', muscle: 'Shoulders', equipment: 'Other' },
  // Biceps
  { id: 'curl', name: 'Barbell Curl', muscle: 'Biceps', equipment: 'Barbell' },
  { id: 'db-curl', name: 'Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell' },
  { id: 'cable-curl', name: 'Cable Curl', muscle: 'Biceps', equipment: 'Cable' },
  { id: 'incline-db-curl', name: 'Incline Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell' },
  { id: 'machine-curl', name: 'Machine Biceps Curl', muscle: 'Biceps', equipment: 'Machine' },
  { id: 'overhead-cable-curl', name: 'Overhead Cable Curl', muscle: 'Biceps', equipment: 'Cable' },
  // Triceps
  { id: 'tricep-push', name: 'Tricep Pushdown', muscle: 'Triceps', equipment: 'Cable' },
  { id: 'skull-crusher', name: 'Skull Crusher', muscle: 'Triceps', equipment: 'Barbell' },
  { id: 'dip', name: 'Dip', muscle: 'Triceps', equipment: 'Bodyweight' },
  { id: 'cable-overhead-ext', name: 'Cable Overhead Triceps Extension', muscle: 'Triceps', equipment: 'Cable' },
  { id: 'cross-body-triceps-ext', name: 'Cross-Body Cable Triceps Extension', muscle: 'Triceps', equipment: 'Cable' },
  { id: 'db-skull-crusher', name: 'Dumbbell Skull Crusher', muscle: 'Triceps', equipment: 'Dumbbell' },
  { id: 'diamond-pushup', name: 'Diamond Push-Up', muscle: 'Triceps', equipment: 'Bodyweight' },
  // Quads
  { id: 'squat', name: 'Back Squat', muscle: 'Quads', equipment: 'Barbell' },
  { id: 'front-squat', name: 'Front Squat', muscle: 'Quads', equipment: 'Barbell' },
  { id: 'smith-squat', name: 'Smith Machine Squat', muscle: 'Quads', equipment: 'Machine' },
  { id: 'leg-press', name: 'Leg Press', muscle: 'Quads', equipment: 'Machine' },
  { id: 'leg-ext', name: 'Leg Extension', muscle: 'Quads', equipment: 'Machine' },
  { id: 'db-walking-lunge', name: 'Dumbbell Walking Lunge', muscle: 'Quads', equipment: 'Dumbbell' },
  // Hamstrings
  { id: 'rdl', name: 'Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Barbell' },
  { id: 'leg-curl', name: 'Leg Curl', muscle: 'Hamstrings', equipment: 'Machine' },
  { id: 'seated-leg-curl', name: 'Seated Leg Curl', muscle: 'Hamstrings', equipment: 'Machine' },
  { id: 'smith-rdl', name: 'Smith Machine Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Machine' },
  { id: 'db-sldl', name: 'Dumbbell Stiff-Leg Deadlift', muscle: 'Hamstrings', equipment: 'Dumbbell' },
  // Glutes
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Glutes', equipment: 'Barbell' },
  { id: 'glute-bridge', name: 'Glute Bridge', muscle: 'Glutes', equipment: 'Bodyweight' },
  { id: 'smith-hip-thrust', name: 'Smith Machine Hip Thrust', muscle: 'Glutes', equipment: 'Machine' },
  // Calves
  { id: 'calf-raise', name: 'Calf Raise', muscle: 'Calves', equipment: 'Machine' },
  { id: 'standing-calf', name: 'Standing Calf Raise', muscle: 'Calves', equipment: 'Barbell' },
  { id: 'seated-calf', name: 'Seated Calf Raise', muscle: 'Calves', equipment: 'Machine' },
  { id: 'leg-press-calf', name: 'Leg Press Calf Raise', muscle: 'Calves', equipment: 'Machine' },
  // Core
  { id: 'plank', name: 'Plank', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'crunch', name: 'Crunch', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'ab-rollout', name: 'Ab Rollout', muscle: 'Core', equipment: 'Other' },
  { id: 'ab-machine', name: 'Abdominal Machine', muscle: 'Core', equipment: 'Machine' },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'captains-chair-leg-raise', name: 'Captain’s Chair Leg Raise', muscle: 'Core', equipment: 'Bodyweight' },
  { id: 'cable-crunch', name: 'Cable Crunch', muscle: 'Core', equipment: 'Cable' },
];

export const MUSCLES = [...new Set(EXERCISES.map(e => e.muscle))];

export function getExercise(id: string): Exercise | undefined {
  return EXERCISES.find(e => e.id === id);
}
