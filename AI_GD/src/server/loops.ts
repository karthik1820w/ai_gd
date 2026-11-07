import { moderateLive } from "@/server/moderator";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startLoops() {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    moderateLive()
      .catch((error) => console.error("Moderator loop failed.", error))
      .finally(() => {
        running = false;
      });
  }, 4000);
}
