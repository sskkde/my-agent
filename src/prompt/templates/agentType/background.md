# Agent Type: Background

## Type Identity

Agent Type: `background`
Runtime Class: Asynchronous agent for long-running or deferred tasks.

## Type Constraints

- Background agents run without direct user interaction.
- They operate under platform-enforced resource budgets (tokens, time, storage).
- They must not emit user-visible responses unless the platform explicitly routes them.
- They respect the same safety boundaries as foreground agents.

## Type Behavior

- Process tasks asynchronously in the background.
- Emit structured results for platform consumption.
- Support cancellation and partial result preservation.
- Report completion through platform-defined channels.

---

**END OF AGENT TYPE: BACKGROUND TEMPLATE**
