---
name: memory-evolver
description: Self-evolving memory system for game dev AI agents. Analyzes project history, extracts patterns, and continuously improves the memory infrastructure.
tags: [game-dev, memory, ai, self-improvement, evolution]
---

# Memory Evolver

A protocol-constrained self-evolution engine for the game dev memory system. Inspired by the Gene Evolution Protocol (GEP), adapted for game development knowledge management.

## What It Does

The Memory Evolver continuously improves the game dev memory infrastructure by:

1. **Analyzing** project sessions, errors, and patterns from game dev work
2. **Extracting** reusable knowledge (patterns, decisions, bugs, architecture notes)
3. **Evolving** the memory schema, retrieval logic, and categorization system
4. **Pruning** stale or low-confidence memories
5. **Cross-pollinating** knowledge across game projects

## Evolution Modes

### Repair Mode
Triggered when errors or inconsistencies are detected:
- Fix broken memory references
- Resolve conflicting patterns
- Update outdated architecture decisions

### Optimize Mode
Triggered when the system is stable:
- Consolidate duplicate memories
- Improve memory categorization and tagging
- Boost retrieval relevance by adjusting confidence scores

### Innovate Mode
Triggered by opportunity signals:
- Discover new pattern categories from project data
- Create cross-project knowledge bridges
- Generate predictive insights from accumulated game dev experience

## Usage

### Single Evolution Cycle
```
/evolve-memory
```

### With Review (Human-in-the-Loop)
```
/evolve-memory --review
```

### Target Specific Project
```
/evolve-memory --project=<project-id>
```

### 100-Round Loop (Hands-Off)
Run up to 100 cycles in a single process (the loop also self-recycles on high RSS):
```
node index.js --loop --cycles=100
```

## Gene Protocol

Evolution is driven by reusable "genes" - structured templates that encode specific improvement strategies:

- `assets/genes/genes.json` - Reusable evolution building blocks
- `assets/genes/capsules.json` - Validated success patterns
- `assets/genes/events.jsonl` - Append-only evolution audit log

## Memory Categories

| Category | Description |
|----------|-------------|
| `pattern` | Recurring solutions or approaches in game dev |
| `decision` | Architecture or design decisions with rationale |
| `bug` | Bug patterns and their resolutions |
| `architecture` | System design knowledge |
| `asset` | Asset pipeline and management knowledge |
| `lesson` | Lessons learned from project experiences |

## Safety

- All evolution changes are logged and auditable
- High-risk mutations (schema changes, bulk updates) require review mode
- Confidence scores prevent low-quality memories from polluting the system
- Rollback support via evolution event chain
