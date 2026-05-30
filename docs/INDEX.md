# Nerveflow Documentation

This documentation is organized into user guides, onboarding, and repo-only engineering references.

## User Guides (Published to npm)

- [guide/01-what-is-nerve.md](guide/01-what-is-nerve.md)
- [guide/02-getting-started.md](guide/02-getting-started.md)
- [guide/03-language-reference.md](guide/03-language-reference.md)
- [guide/04-host-integration.md](guide/04-host-integration.md)
- [guide/05-platform-vision.md](guide/05-platform-vision.md)
- [guide/10-host-db-connectors.md](guide/10-host-db-connectors.md)
- [guide/10-host-db-connectors-low-level.md](guide/10-host-db-connectors-low-level.md)
- [guide/11-production-readiness.md](guide/11-production-readiness.md)
- [guide/12-docker-deployment.md](guide/12-docker-deployment.md)
- [guide/13-user-handbook.md](guide/13-user-handbook.md)

## Onboarding (Repo docs)

- [onboarding/step-1.md](onboarding/step-1.md) — Install and verify the base runtime
- [onboarding/step-2.md](onboarding/step-2.md) — Add an LLM and run a stateful chatbot
- [onboarding/step-3.md](onboarding/step-3.md) — Use Nerve Studio to inspect the runtime
- [onboarding/step-4.md](onboarding/step-4.md) — Build your first bounded-decision workflow
- [onboarding/step-5.md](onboarding/step-5.md) — Run through a host and add your first tool call

After Step 5, choose your path:

- [onboarding/step-6a.md](onboarding/step-6a.md) — Add a vector database for real RAG
- [onboarding/step-6b.md](onboarding/step-6b.md) — Add speech capability
- [onboarding/step-6c.md](onboarding/step-6c.md) — Add MCP servers
- [onboarding/step-6d.md](onboarding/step-6d.md) — Add semantic-surface capability

## Agent docs

- [platform/platform-agent-guide.md](platform/platform-agent-guide.md)
- [project-generation/project-generator-guide.md](project-generation/project-generator-guide.md)
- [project-generation/workflow-generation-rules.md](project-generation/workflow-generation-rules.md)
- [project-generation/agent-language-reference.md](project-generation/agent-language-reference.md)
- [project-generation/workflow-checklists.md](project-generation/workflow-checklists.md)
- [project-generation/canonical-snippets.md](project-generation/canonical-snippets.md)

## Agent docs migration note

Legacy transition pages were retired. Use [project-generation/](project-generation/) as the canonical workflow-generation docs set.

## Specifications

- [../design/specs/spec-structured-return-contracts.md](../design/specs/spec-structured-return-contracts.md)
- [../design/specs/spec-late-contract-binding.md](../design/specs/spec-late-contract-binding.md)
- [../design/specs/spec-bounded-control-flow-provenance.md](../design/specs/spec-bounded-control-flow-provenance.md)
- [../design/specs/spec-parallel-group-evaluation.md](../design/specs/spec-parallel-group-evaluation.md)
- [../design/specs/spec-explicit-runtime-failure-envelopes.md](../design/specs/spec-explicit-runtime-failure-envelopes.md)
- [../design/specs/spec-semantic-surface-capability.md](../design/specs/spec-semantic-surface-capability.md)

## Operational & Release

- [guide/11-production-readiness.md](guide/11-production-readiness.md) — Production readiness gates and pre-publish checklist
- [guide/12-docker-deployment.md](guide/12-docker-deployment.md) — Deploy one workflow workspace as a Dockerized app

## Host patterns

- [examples/multi-surface-attachment-pattern.md](examples/multi-surface-attachment-pattern.md)

## Editor-Core Companion Package

- [../packages/editor-core/README.md](../packages/editor-core/README.md) — package API, usage, and source-of-truth workflow
- [../packages/editor-core/docs/HOST_CONTRACT.md](../packages/editor-core/docs/HOST_CONTRACT.md) — host integration contract for editor surfaces
- [../packages/editor-core/docs/PLUGIN_CONTRACT.md](../packages/editor-core/docs/PLUGIN_CONTRACT.md) — plugin output and behavior contract
- [guide/11-production-readiness.md](guide/11-production-readiness.md) — includes editor-core sync and pack verification gates

## Example scripts

- [examples/hello-router.nrv](examples/hello-router.nrv)
- [examples/stateful-pipeline.nrv](examples/stateful-pipeline.nrv)
- [examples/signal-queue-pattern.nrv](examples/signal-queue-pattern.nrv)
