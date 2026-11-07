# AI GD workspace

This repository contains two independent applications:

| Project | Description | Setup and commands |
| --- | --- | --- |
| [AI-GD-Platform](./AI-GD-Platform/README.md) | Node.js discussion platform with a backend, database, Redis, and LiveKit services | See the project README; backend tests run from `AI-GD-Platform/backend` |
| [AI_GD](./AI_GD/README.md) | Quorum web application built with Next.js, Prisma, and TypeScript | Run commands from `AI_GD` |

GitHub Actions runs CI for both projects from `.github/workflows/ci.yml`.
Each application keeps its own dependencies, configuration, and documentation;
run its commands from that project's directory.

# ai_gd
