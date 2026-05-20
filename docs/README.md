# Nerveflow Documentation

This documentation is for **users building workflows with Nerveflow**.

## Start here

- [01-what-is-nerve.md](01-what-is-nerve.md)
- [02-getting-started.md](02-getting-started.md)

## Onboarding sequence

- [onboarding-step-1.md](onboarding-step-1.md) — Install and verify the base runtime
- [onboarding-step-2.md](onboarding-step-2.md) — Add an LLM and run a stateful chatbot
- [onboarding-step-3.md](onboarding-step-3.md) — Use Nerve Studio to inspect the runtime
- [onboarding-step-4.md](onboarding-step-4.md) — Build your first bounded-decision workflow
- [onboarding-step-5.md](onboarding-step-5.md) — Run through a host and add your first tool call

After Step 5, choose your path:

- [onboarding-step-6a.md](onboarding-step-6a.md) — Add a vector database for real RAG
- [onboarding-step-6b.md](onboarding-step-6b.md) — Add speech capability
- [onboarding-step-6c.md](onboarding-step-6c.md) — Add MCP servers

## Reference

- [03-language-reference.md](03-language-reference.md)
- [04-host-integration.md](04-host-integration.md)
- [05-platform-vision.md](05-platform-vision.md)
- [13-user-handbook.md](13-user-handbook.md)
- [10-host-db-connectors.md](10-host-db-connectors.md)
- [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md)

## Agent docs

- [platform/platform-agent-guide.md](platform/platform-agent-guide.md)
- [project-generation/project-generator-guide.md](project-generation/project-generator-guide.md)
- [project-generation/workflow-generation-rules.md](project-generation/workflow-generation-rules.md)
- [project-generation/agent-language-reference.md](project-generation/agent-language-reference.md)
- [project-generation/workflow-checklists.md](project-generation/workflow-checklists.md)
- [project-generation/canonical-snippets.md](project-generation/canonical-snippets.md)

## Legacy agent docs (transition)

- [06-agent-project-guide.md](06-agent-project-guide.md)
- [07-agent-language-reference.md](07-agent-language-reference.md)
- [08-agent-checklists.md](08-agent-checklists.md)
- [09-agent-canonical-snippets.md](09-agent-canonical-snippets.md)

## Specifications

- [spec-structured-return-contracts.md](spec-structured-return-contracts.md)
- [spec-late-contract-binding.md](spec-late-contract-binding.md)
- [spec-bounded-control-flow-provenance.md](spec-bounded-control-flow-provenance.md)
- [spec-parallel-group-evaluation.md](spec-parallel-group-evaluation.md)
- [spec-explicit-runtime-failure-envelopes.md](spec-explicit-runtime-failure-envelopes.md)

## Operational & Release

- [11-production-readiness.md](11-production-readiness.md) — Production readiness gates and pre-publish checklist
- [12-docker-deployment.md](12-docker-deployment.md) — Deploy one workflow workspace as a Dockerized app

## Host patterns

- [examples/multi-surface-attachment-pattern.md](examples/multi-surface-attachment-pattern.md)

## Editor-Core Companion Package

- [../packages/editor-core/README.md](../packages/editor-core/README.md) — package API, usage, and source-of-truth workflow
- [../packages/editor-core/docs/HOST_CONTRACT.md](../packages/editor-core/docs/HOST_CONTRACT.md) — host integration contract for editor surfaces
- [../packages/editor-core/docs/PLUGIN_CONTRACT.md](../packages/editor-core/docs/PLUGIN_CONTRACT.md) — plugin output and behavior contract
- [11-production-readiness.md](11-production-readiness.md) — includes editor-core sync and pack verification gates

## Example scripts

- [examples/hello-router.nrv](examples/hello-router.nrv)
- [examples/stateful-pipeline.nrv](examples/stateful-pipeline.nrv)
- [examples/signal-queue-pattern.nrv](examples/signal-queue-pattern.nrv)
