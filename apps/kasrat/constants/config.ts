// Update SERVER_URL after deploying to your VPS
// Run: ssh sachem "curl -s ifconfig.me" to get your VPS IP
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://198.251.65.198:3000';
