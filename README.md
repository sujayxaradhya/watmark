# watmark

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines SvelteKit, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **SvelteKit** - Web framework for building Svelte apps
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Starlight** - Documentation site with Astro

## Getting Started

First, install the dependencies:

```bash
bun install
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.

## Git Hooks and Formatting

- Format and lint fix: `bun run check`

## Project Structure

```
watmark/
├── apps/
│   ├── web/         # Frontend application (SvelteKit)
│   ├── docs/        # Documentation site (Astro Starlight)
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run check-types`: Check TypeScript types across all apps
- `bun run check`: Run Oxlint and Oxfmt
- `cd apps/docs && bun run dev`: Start documentation site
- `cd apps/docs && bun run build`: Build documentation site
