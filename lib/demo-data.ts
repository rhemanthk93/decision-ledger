import type { DLDocument, Decision, Conflict } from './types'

export const DEMO_DOCUMENTS: DLDocument[] = [
  {
    id: 'demo-doc-1',
    name: 'Q1 Architecture Review — Engineering All-Hands',
    doc_type: 'transcript',
    uploaded_at: '2026-03-15T10:00:00Z',
    status: 'done',
    content: `Q1 Architecture Review — March 15, 2026
Attendees: Alice Chen (Engineering Lead), Bob Park (Backend), Carol Liu (DBA), Dave Kim (Infra)

Alice: Let's lock down our core technology decisions for the new platform today. No more debates.

[DATABASE]
Bob: Full evaluation complete. PostgreSQL wins on every dimension — ACID compliance, team expertise, relational model, pgvector for ML features.
Carol: Agreed. MongoDB's flexible schemas are a liability for billing data. We'd fight the schema-less model constantly.
Alice: Decision made. We will use PostgreSQL as the primary database for the entire new platform. This is an architectural decision — not up for revisit without a formal ADR.
Dave: I'll start provisioning RDS PostgreSQL 16 this week.

[FRONTEND]
Alice: Frontend framework — we're going with React and Next.js. Team knows it, ecosystem is mature, SSR support is critical for SEO.
Bob: Agreed. React with Next.js as our standard frontend framework.

[AUTH]
Alice: Authentication. We evaluated Auth0, Cognito, and rolling our own. Decision: OAuth 2.0 via Auth0. SOC2 compliance, no auth liability, proven at scale.
Bob: Auth0 it is. I'll start the integration docs.`,
  },
  {
    id: 'demo-doc-2',
    name: 'ADR-0012: Database Selection for New Platform',
    doc_type: 'adr',
    uploaded_at: '2026-03-20T09:00:00Z',
    status: 'done',
    content: `# ADR-0012: Database Selection for New Platform

Date: March 20, 2026
Status: Accepted
Deciders: Alice Chen, Bob Park, Carol Liu

## Context
New platform requires a primary database. Options: PostgreSQL, MongoDB, MySQL, CockroachDB.

## Decision
We will formally adopt PostgreSQL as the primary database for the new platform.

This ratifies the Q1 Architecture Review decision (March 15, 2026).

## Rationale
- Team has deep PostgreSQL expertise (avg 4+ years per engineer)
- Billing data requires strict ACID compliance
- Relational data model maps cleanly to domain objects
- pgvector ready for future ML features
- Proven at 10x our scale

## Consequences
- All new services MUST use PostgreSQL
- Schema migrations required for model changes (intentional discipline)
- Infrastructure: RDS PostgreSQL 16 with read replicas

## Alternatives Rejected
- MongoDB: Schema flexibility is a liability for billing; team less familiar
- MySQL: Less feature-rich than Postgres
- CockroachDB: Unnecessary complexity for current scale`,
  },
  {
    id: 'demo-doc-3',
    name: 'PR #847 — Billing Service: Migrate to MongoDB',
    doc_type: 'pr',
    uploaded_at: '2026-05-03T14:22:00Z',
    status: 'done',
    content: `## Pull Request #847
Title: billing-service: migrate storage layer to MongoDB
Author: james.wilson
Date: May 3, 2026

## Summary
Switching the billing service storage from PostgreSQL to MongoDB for schema flexibility.

Our billing data model has been evolving rapidly. Every Postgres schema change requires a migration and coordinated deploy window. MongoDB's document model lets the billing team iterate faster.

## Changes
- Replaced pg client with mongoose ODM
- Migrated billing_events, invoices, subscriptions to MongoDB collections
- Added MongoDB Atlas connection in billing-service config
- Removed Postgres dependency from billing-service

## Why MongoDB?
12 schema migrations in the last quarter. MongoDB's flexible document model eliminates this friction. Billing's nested objects (line items, discounts, promo codes) map naturally to documents.

## Notes
- Only affects billing-service, not core platform
- MongoDB Atlas already provisioned (billing team spun up their own cluster)
- No formal ADR was created for this change — keeping it pragmatic

Reviewers: @sarah.johnson @tech-lead`,
  },
  {
    id: 'demo-doc-4',
    name: 'Slack Thread — #engineering — Infra + Caching Decisions',
    doc_type: 'slack',
    uploaded_at: '2026-04-10T16:45:00Z',
    status: 'done',
    content: `Slack Export: #engineering-decisions
Date: April 10, 2026

alice.chen [4:32 PM]: Auth update — confirmed: we are using Auth0 as the authentication provider across all services. PKCE flow. SOC2 Type II was the deciding factor. No Cognito, no Firebase Auth.

bob.park [4:33 PM]: Confirmed. Auth0 OAuth 2.0 with PKCE for all services.

alice.chen [4:34 PM]: All services must use Auth0. No rolling our own auth. This replaces any previous discussion about alternatives.

dave.kim [4:38 PM]: For infra — let's close the Kubernetes debate. We are deploying on AWS ECS. No Kubernetes. The operational overhead isn't worth it at our current scale. ECS with Fargate is the decision.

alice.chen [4:40 PM]: Agreed on ECS. Dave's call on infra tooling. We use ECS and Fargate for all service deployments. Kubernetes is off the table.

dave.kim [4:41 PM]: Perfect. I'll document this. ECS is the container orchestration standard going forward.`,
  },
  {
    id: 'demo-doc-5',
    name: 'Q2 Planning Memo — Platform Roadmap',
    doc_type: 'memo',
    uploaded_at: '2026-07-01T08:00:00Z',
    status: 'done',
    content: `Q2 Platform Planning Memo
To: Engineering Leadership
From: Alice Chen
Date: July 1, 2026

## Caching Strategy
After evaluating options, we have decided to use Redis as our standard caching solution for session management, ephemeral data, and rate limiting across all services. Redis Cluster on ElastiCache. This replaces any ad-hoc in-memory caching approaches.

## Admin Panel Frontend
The admin panel needs to be rebuilt. Engineering is evaluating Svelte as an alternative to React for the admin panel specifically — smaller bundle, less boilerplate. The team will run a Svelte proof-of-concept for the admin panel frontend. Decision pending completion of the POC.

## New Services
Spinning up three microservices this quarter:
1. Analytics Service — leaning toward ClickHouse for OLAP
2. Notification Service — MVP by July 31
3. Search Service — evaluating Elasticsearch vs. OpenSearch`,
  },
  {
    id: 'demo-doc-6',
    name: 'ADR-0023: Admin Panel Frontend Framework',
    doc_type: 'adr',
    uploaded_at: '2026-08-05T11:00:00Z',
    status: 'done',
    content: `# ADR-0023: Admin Panel Frontend Framework

Date: August 5, 2026
Status: Accepted
Deciders: Alice Chen, Frontend Lead, UX Team

## Context
Q2 memo initiated a POC to evaluate Svelte for the admin panel. POC is now complete.

## Decision
We are reverting the admin panel to React. We will discontinue the Svelte evaluation.

The Svelte POC revealed significant issues:
- Team onboarding cost was underestimated (3 engineers needed to learn Svelte from scratch)
- Svelte's ecosystem lacks key libraries we depend on (complex form handling, data grid components)
- Two engineers who built the POC have since left the team
- Maintenance burden exceeds the bundle size savings

## Consequences
- Admin panel will be rebuilt in React with Next.js (same as the main platform)
- Code sharing between admin and main platform is now possible
- Svelte is removed from the approved tech stack

## Alternatives Rejected
- Continue with Svelte: Knowledge concentration risk is too high after team changes`,
  },
  {
    id: 'demo-doc-7',
    name: 'Platform Retrospective — Infra Q4 Review',
    doc_type: 'memo',
    uploaded_at: '2026-10-20T10:00:00Z',
    status: 'done',
    content: `Platform Infrastructure Retrospective
Date: October 20, 2026
Author: Dave Kim (Platform Lead)

## Container Orchestration: ECS → Kubernetes Migration

After 6 months on ECS, we are migrating all services to Kubernetes.

Decision: We will migrate from ECS to Kubernetes for all production services by end of Q1 2027.

Rationale:
- Service mesh requirements: we need Istio for zero-trust networking between services
- Horizontal pod autoscaling is significantly more granular than ECS service scaling
- Cross-cloud portability — a strategic requirement from leadership for 2027
- The operational overhead objection from April is no longer valid — we've hired two platform engineers with deep k8s experience
- Cost optimization: bin-packing is 23% more efficient than ECS task sizing

Timeline: Migrate stateless services first (Q4 2026), then stateful services (Q1 2027).

This supersedes the April 10, 2026 ECS decision.`,
  },
  {
    id: 'demo-doc-8',
    name: 'API Design Standards — Engineering Guild',
    doc_type: 'adr',
    uploaded_at: '2026-09-12T14:00:00Z',
    status: 'done',
    content: `# ADR-0031: API Design Standards

Date: September 12, 2026
Status: Accepted
Deciders: Alice Chen, Backend Guild, Platform Team

## Decisions

### Internal Service Communication
We will use gRPC for all internal service-to-service API communication.
Rationale: Strong typing, efficient binary serialization, streaming support, generated clients.

### External/Public APIs
All public-facing APIs must be REST with OpenAPI 3.0 spec published.
Rationale: Developer familiarity, tooling ecosystem, easier third-party integration.

### GraphQL
GraphQL is approved for the data aggregation layer (BFF pattern) only. Not for direct service-to-service calls, not for public APIs.

These standards apply to all new services immediately and all existing services must comply by Q1 2027.`,
  },
]

// Pre-extracted decisions (as if Claude already processed all demo documents)
export const DEMO_DECISIONS: Decision[] = [
  // Database choice cluster
  {
    id: 'demo-dec-1',
    statement: 'Use PostgreSQL as the primary database for the entire new platform',
    topic_cluster: 'Database choice',
    decision_type: 'architectural',
    status: 'contradicted',
    decided_at: '2026-03-15',
    decided_by: ['Alice Chen', 'Bob Park', 'Carol Liu'],
    source_doc_id: 'demo-doc-1',
    source_excerpt: 'We will use PostgreSQL as the primary database for the entire new platform. This is an architectural decision — not up for revisit without a formal ADR.',
    rationale: 'ACID compliance, team expertise, relational model, pgvector for ML features',
    confidence: 0.98,
  },
  {
    id: 'demo-dec-4',
    statement: 'Formally adopt PostgreSQL as the primary database per ADR-0012',
    topic_cluster: 'Database choice',
    decision_type: 'architectural',
    status: 'contradicted',
    decided_at: '2026-03-20',
    decided_by: ['Alice Chen', 'Bob Park', 'Carol Liu'],
    source_doc_id: 'demo-doc-2',
    source_excerpt: 'We will formally adopt PostgreSQL as the primary database for the new platform.',
    rationale: 'Ratifies Q1 Architecture Review decision with full formal documentation',
    confidence: 0.99,
  },
  {
    id: 'demo-dec-5',
    statement: 'Migrate billing service storage from PostgreSQL to MongoDB',
    topic_cluster: 'Database choice',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-05-03',
    decided_by: ['James Wilson'],
    source_doc_id: 'demo-doc-3',
    source_excerpt: 'Switching the billing service storage from PostgreSQL to MongoDB for schema flexibility. No formal ADR was created for this change.',
    rationale: 'Schema evolution friction with Postgres — 12 migrations in last quarter',
    confidence: 0.92,
  },

  // Frontend framework cluster
  {
    id: 'demo-dec-2',
    statement: 'Use React with Next.js as the standard frontend framework',
    topic_cluster: 'Frontend framework',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-03-15',
    decided_by: ['Alice Chen', 'Bob Park'],
    source_doc_id: 'demo-doc-1',
    source_excerpt: 'React with Next.js as our standard frontend framework.',
    rationale: 'Team familiarity, mature ecosystem, SSR support for SEO',
    confidence: 0.95,
  },
  {
    id: 'demo-dec-7',
    statement: 'Admin panel frontend will use Svelte — POC authorized to proceed',
    topic_cluster: 'Admin panel technology',
    decision_type: 'product',
    status: 'reversed',
    decided_at: '2026-07-01',
    decided_by: ['Alice Chen'],
    source_doc_id: 'demo-doc-5',
    source_excerpt: 'Engineering is evaluating Svelte as an alternative to React for the admin panel specifically.',
    rationale: 'Smaller bundle size, less boilerplate for admin-only UI',
    confidence: 0.82,
  },
  {
    id: 'demo-dec-10',
    statement: 'Admin panel switches back to React — Svelte POC abandoned per ADR-0023',
    topic_cluster: 'Admin panel technology',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-08-05',
    decided_by: ['Alice Chen', 'Frontend Lead'],
    source_doc_id: 'demo-doc-6',
    source_excerpt: 'We are reverting the admin panel to React. We will discontinue the Svelte evaluation.',
    rationale: 'Team onboarding cost, missing ecosystem libraries, team attrition after POC',
    confidence: 0.97,
  },

  // Authentication provider cluster
  {
    id: 'demo-dec-3',
    statement: 'Use Auth0 for OAuth 2.0 authentication across all services',
    topic_cluster: 'Authentication provider',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-03-15',
    decided_by: ['Alice Chen', 'Bob Park'],
    source_doc_id: 'demo-doc-1',
    source_excerpt: 'Decision: OAuth 2.0 via Auth0. SOC2 compliance, no auth liability, proven at scale.',
    rationale: 'SOC2 Type II compliance, avoid owning auth liability',
    confidence: 0.97,
  },
  {
    id: 'demo-dec-8',
    statement: 'Auth0 confirmed as authentication standard with PKCE flow required for all services',
    topic_cluster: 'Authentication provider',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-04-10',
    decided_by: ['Alice Chen', 'Bob Park'],
    source_doc_id: 'demo-doc-4',
    source_excerpt: 'All services must use Auth0. No rolling our own auth. Auth0 OAuth 2.0 with PKCE for all services.',
    confidence: 0.96,
  },

  // Caching strategy cluster
  {
    id: 'demo-dec-6',
    statement: 'Use Redis as the standard caching solution for session management and ephemeral data',
    topic_cluster: 'Caching strategy',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-07-01',
    decided_by: ['Alice Chen'],
    source_doc_id: 'demo-doc-5',
    source_excerpt: 'We have decided to use Redis as our standard caching solution for session management, ephemeral data, and rate limiting across all services.',
    rationale: 'Redis Cluster on ElastiCache, replaces ad-hoc in-memory caching',
    confidence: 0.94,
  },

  // Container orchestration cluster
  {
    id: 'demo-dec-9',
    statement: 'Deploy using AWS ECS and Fargate — Kubernetes is off the table',
    topic_cluster: 'Container orchestration',
    decision_type: 'architectural',
    status: 'reversed',
    decided_at: '2026-04-10',
    decided_by: ['Dave Kim', 'Alice Chen'],
    source_doc_id: 'demo-doc-4',
    source_excerpt: 'We are deploying on AWS ECS. No Kubernetes. ECS and Fargate for all service deployments.',
    rationale: 'Operational overhead of Kubernetes not worth it at current scale',
    confidence: 0.96,
  },
  {
    id: 'demo-dec-12',
    statement: 'Migrate all services from ECS to Kubernetes for service mesh and cross-cloud portability',
    topic_cluster: 'Container orchestration',
    decision_type: 'strategic',
    status: 'active',
    decided_at: '2026-10-20',
    decided_by: ['Dave Kim', 'Platform Team'],
    source_doc_id: 'demo-doc-7',
    source_excerpt: 'We will migrate from ECS to Kubernetes for all production services by end of Q1 2027. This supersedes the April 10, 2026 ECS decision.',
    rationale: 'Service mesh (Istio), better autoscaling, cross-cloud portability, 23% cost saving via bin-packing',
    confidence: 0.95,
  },

  // API design cluster
  {
    id: 'demo-dec-11',
    statement: 'Use gRPC for all internal service-to-service API communication',
    topic_cluster: 'API design standards',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-09-12',
    decided_by: ['Alice Chen', 'Backend Guild'],
    source_doc_id: 'demo-doc-8',
    source_excerpt: 'We will use gRPC for all internal service-to-service API communication.',
    rationale: 'Strong typing, binary serialization, streaming support, generated clients',
    confidence: 0.95,
  },
  {
    id: 'demo-dec-13',
    statement: 'All public-facing APIs must use REST with OpenAPI 3.0 spec',
    topic_cluster: 'API design standards',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-09-12',
    decided_by: ['Alice Chen', 'Backend Guild'],
    source_doc_id: 'demo-doc-8',
    source_excerpt: 'All public-facing APIs must be REST with OpenAPI 3.0 spec published.',
    rationale: 'Developer familiarity, tooling ecosystem, third-party integration',
    confidence: 0.93,
  },
]

export const DEMO_CONFLICTS: Conflict[] = [
  {
    id: 'demo-conflict-1',
    earlier_decision_id: 'demo-dec-1',
    later_decision_id: 'demo-dec-5',
    conflict_type: 'silent_change',
  },
  {
    id: 'demo-conflict-2',
    earlier_decision_id: 'demo-dec-4',
    later_decision_id: 'demo-dec-5',
    conflict_type: 'silent_change',
  },
  {
    id: 'demo-conflict-3',
    earlier_decision_id: 'demo-dec-7',
    later_decision_id: 'demo-dec-10',
    conflict_type: 'reversal',
  },
  {
    id: 'demo-conflict-4',
    earlier_decision_id: 'demo-dec-9',
    later_decision_id: 'demo-dec-12',
    conflict_type: 'reversal',
  },
]

// ── NEW DOCUMENTS ────────────────────────────────────────────────────────────

const NEW_DOCUMENTS: DLDocument[] = [
  {
    id: 'demo-doc-9',
    name: 'ADR-0008: API Token Security Standards',
    doc_type: 'adr',
    uploaded_at: '2026-04-01T09:00:00Z',
    status: 'done',
    content: `# ADR-0008: API Token Security Standards

Date: April 1, 2026
Status: Accepted
Deciders: Alice Chen, Security Team, Bob Park

## Context
Several services are using long-lived API keys and static secrets for internal
authentication. This creates significant security exposure.

## Decisions

### Token Signing
All API tokens must be signed JWTs with a maximum 1-hour expiry.
No long-lived static tokens or API keys for service authentication.
Rationale: Limit blast radius of credential compromise.

### Zero-Trust Networking
All internal service-to-service calls must present a service identity
certificate (mTLS via Istio). No unauthenticated service calls permitted
across trust boundaries.
Rationale: "Never trust, always verify" — required for SOC2 Type II.

## Consequences
- Existing services using static API keys must rotate within 60 days
- All new services must implement JWT validation middleware on day one
- Infra team will provision Istio service mesh alongside Kubernetes migration`,
  },
  {
    id: 'demo-doc-10',
    name: 'Slack Thread — #infra-decisions — Observability & CI/CD',
    doc_type: 'slack',
    uploaded_at: '2026-05-15T14:30:00Z',
    status: 'done',
    content: `Slack Export: #infra-decisions
Date: May 15, 2026

dave.kim [2:12 PM]: Observability decision — we're going with Datadog as our
single observability platform. APM, logs, dashboards, alerts — everything
through Datadog. No mixing in New Relic, CloudWatch Dashboards, or Grafana
OSS. One pane of glass. This is non-negotiable for on-call ops.

alice.chen [2:14 PM]: Agreed. All services must also emit structured JSON logs
with a correlation ID field. No plain-text logs. Correlation IDs let us trace
requests across services in Datadog. This is a platform standard from today.

dave.kim [2:17 PM]: Also — CI/CD. We are standardising on GitHub Actions.
No Jenkins. No CircleCI. GitHub Actions for all pipelines — build, test, deploy.
We have runners provisioned on our AWS account. Migrate any remaining Jenkins
jobs by end of Q2.

bob.park [2:19 PM]: Makes sense. I'll update the onboarding docs.

alice.chen [2:20 PM]: Thanks Dave. To summarise: Datadog for observability,
structured JSON logs with correlation IDs, GitHub Actions for all CI/CD.
These are platform standards. No exceptions without an ADR.`,
  },
  {
    id: 'demo-doc-11',
    name: 'PR #891 — admin-panel: migrate auth from Auth0 to Clerk',
    doc_type: 'pr',
    uploaded_at: '2026-09-01T11:45:00Z',
    status: 'done',
    content: `## Pull Request #891
Title: admin-panel: replace Auth0 SDK with Clerk for Next.js auth
Author: marcus.lee
Date: September 1, 2026

## Summary
Migrating admin panel authentication from Auth0 to Clerk.

Auth0's Next.js SDK requires a custom session handler that's painful to
integrate with App Router server components. Clerk has first-class Next.js
App Router support with a single middleware line and ready-made UI components.

## Changes
- Replaced @auth0/nextjs-auth0 with @clerk/nextjs
- Removed Auth0 callback routes and session handlers
- Added Clerk middleware to app/middleware.ts
- Updated admin panel user management to use Clerk user objects

## Why Clerk?
- Clerk's Next.js integration is 10x simpler than Auth0 for App Router
- Pre-built <UserButton>, <SignIn>, <SignOut> components save 2 sprints
- Admin team's Auth0 configuration was broken after Next.js 15 upgrade anyway

## Notes
- Only affects admin-panel service, not web or API services
- Clerk organisation already provisioned by admin team
- No formal ADR created — keeping it pragmatic for the admin rebuild sprint

Reviewers: @frontend-lead`,
  },
  {
    id: 'demo-doc-12',
    name: 'Q3 Engineering Standards — Platform Guild Memo',
    doc_type: 'memo',
    uploaded_at: '2026-08-05T09:00:00Z',
    status: 'done',
    content: `Q3 Engineering Standards — Platform Guild
Date: August 5, 2026
Author: Alice Chen

## Deployment Safety
Effective immediately: all production releases must use blue-green deployments.
No direct in-place upgrades to production. Blue-green is non-negotiable after
the billing-service outage in July (caused by a failed in-place migration).
Rollback time is reduced from ~20 minutes to under 60 seconds with blue-green.

## Data Ownership
Services own their data. No service may query another service's database
directly — this applies to both read and write access. All cross-service data
access must go through the owning service's API. This is the fundamental rule
preventing the distributed monolith antipattern.

## Code Quality
Minimum 80% code coverage is required for all new service code before
production release. This is a hard gate on the CI/CD pipeline — PRs that
drop service coverage below 80% will not be merged. Existing services have
90 days to reach this threshold.

These three standards are effective immediately for all new services and
apply retroactively to services being actively developed.`,
  },
  {
    id: 'demo-doc-13',
    name: 'PR #1089 — notification-service: v1.0 initial release',
    doc_type: 'pr',
    uploaded_at: '2026-10-05T16:00:00Z',
    status: 'done',
    content: `## Pull Request #1089
Title: notification-service: v1.0 — ship initial release
Author: priya.nair
Date: October 5, 2026

## Summary
Initial production release of the notification service (email + push).

## What's included
- Email delivery via SendGrid
- Push notifications via FCM
- Notification preference management
- Retry logic with exponential backoff

## Test coverage note
Current coverage is 23%. I know this is below the 80% standard set in the
Q3 memo but we're under deadline pressure for the mobile app launch (Oct 15).

Plan: reach 80% coverage in the sprint immediately following launch. The
core delivery paths and retry logic are covered. The uncovered code is mostly
error handler branches that are hard to trigger in unit tests.

Requesting exception approval from Alice to merge under coverage threshold.
Got verbal approval from product to prioritise launch date.

Reviewers: @alice.chen @backend-guild`,
  },
]

// ── NEW DECISIONS ─────────────────────────────────────────────────────────────

const NEW_DECISIONS: Decision[] = [
  // Security standards cluster
  {
    id: 'demo-dec-14',
    statement: 'All API tokens must be signed JWTs with a maximum 1-hour expiry — no static secrets',
    topic_cluster: 'Security standards',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-04-01',
    decided_by: ['Alice Chen', 'Security Team', 'Bob Park'],
    source_doc_id: 'demo-doc-9',
    source_excerpt: 'All API tokens must be signed JWTs with a maximum 1-hour expiry. No long-lived static tokens or API keys for service authentication.',
    rationale: 'Limit blast radius of credential compromise; SOC2 Type II requirement',
    confidence: 0.98,
  },
  {
    id: 'demo-dec-15',
    statement: 'All internal service-to-service calls must use mTLS with service identity certificates (zero-trust)',
    topic_cluster: 'Security standards',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-04-01',
    decided_by: ['Alice Chen', 'Dave Kim', 'Security Team'],
    source_doc_id: 'demo-doc-9',
    source_excerpt: 'All internal service-to-service calls must present a service identity certificate (mTLS via Istio). No unauthenticated service calls permitted across trust boundaries.',
    rationale: 'Zero-trust architecture required for SOC2 Type II compliance',
    confidence: 0.96,
  },

  // Observability cluster
  {
    id: 'demo-dec-16',
    statement: 'Datadog is the single observability platform — no mixing APM, logging, or alerting tools',
    topic_cluster: 'Observability platform',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-05-15',
    decided_by: ['Dave Kim'],
    source_doc_id: 'demo-doc-10',
    source_excerpt: 'We\'re going with Datadog as our single observability platform. APM, logs, dashboards, alerts — everything through Datadog. No mixing in New Relic, CloudWatch Dashboards, or Grafana OSS.',
    rationale: 'Single pane of glass for on-call operations; standardise tooling for team efficiency',
    confidence: 0.97,
  },
  {
    id: 'demo-dec-17',
    statement: 'All services must emit structured JSON logs with a correlation ID field — no plain-text logs',
    topic_cluster: 'Observability platform',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-05-15',
    decided_by: ['Alice Chen', 'Dave Kim'],
    source_doc_id: 'demo-doc-10',
    source_excerpt: 'All services must also emit structured JSON logs with a correlation ID field. No plain-text logs. Correlation IDs let us trace requests across services in Datadog.',
    rationale: 'Enable distributed tracing and cross-service request correlation in Datadog',
    confidence: 0.95,
  },

  // CI/CD cluster
  {
    id: 'demo-dec-18',
    statement: 'GitHub Actions is the standard for all CI/CD pipelines — migrate all remaining Jenkins jobs by end of Q2',
    topic_cluster: 'CI/CD pipeline',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-05-15',
    decided_by: ['Dave Kim', 'Alice Chen'],
    source_doc_id: 'demo-doc-10',
    source_excerpt: 'We are standardising on GitHub Actions. No Jenkins. No CircleCI. GitHub Actions for all pipelines — build, test, deploy.',
    rationale: 'Unified pipeline tooling; GitHub Actions runners already provisioned on AWS',
    confidence: 0.96,
  },

  // Deployment process cluster
  {
    id: 'demo-dec-19',
    statement: 'All production releases must use blue-green deployments — no direct in-place upgrades to production',
    topic_cluster: 'Deployment process',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-08-05',
    decided_by: ['Alice Chen'],
    source_doc_id: 'demo-doc-12',
    source_excerpt: 'All production releases must use blue-green deployments. No direct in-place upgrades to production. Blue-green is non-negotiable after the billing-service outage in July.',
    rationale: 'Billing-service July outage caused by failed in-place migration — rollback must be under 60 seconds',
    confidence: 0.97,
  },

  // Data governance cluster
  {
    id: 'demo-dec-20',
    statement: 'Services own their data — no service may directly query another service\'s database',
    topic_cluster: 'Data governance',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-08-05',
    decided_by: ['Alice Chen'],
    source_doc_id: 'demo-doc-12',
    source_excerpt: 'Services own their data. No service may query another service\'s database directly — this applies to both read and write access. All cross-service data access must go through the owning service\'s API.',
    rationale: 'Prevent distributed monolith antipattern; enforce bounded context boundaries',
    confidence: 0.95,
  },

  // Testing standards cluster
  {
    id: 'demo-dec-21',
    statement: 'Minimum 80% code coverage required for all new service code — hard CI/CD gate before production',
    topic_cluster: 'Testing standards',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-08-05',
    decided_by: ['Alice Chen'],
    source_doc_id: 'demo-doc-12',
    source_excerpt: 'Minimum 80% code coverage is required for all new service code before production release. This is a hard gate on the CI/CD pipeline.',
    rationale: 'Establish consistent quality bar across all platform services',
    confidence: 0.95,
  },

  // Auth provider — admin panel conflict
  {
    id: 'demo-dec-22',
    statement: 'Admin panel authentication migrated from Auth0 to Clerk for Next.js App Router compatibility',
    topic_cluster: 'Authentication provider',
    decision_type: 'architectural',
    status: 'contradicted',
    decided_at: '2026-09-01',
    decided_by: ['Marcus Lee'],
    source_doc_id: 'demo-doc-11',
    source_excerpt: 'Migrating admin panel authentication from Auth0 to Clerk. No formal ADR created — keeping it pragmatic for the admin rebuild sprint.',
    rationale: 'Auth0 Next.js SDK incompatibility with App Router; Clerk has first-class App Router support',
    confidence: 0.93,
  },

  // Testing violation
  {
    id: 'demo-dec-23',
    statement: 'notification-service v1.0 shipped to production with 23% code coverage — below 80% standard',
    topic_cluster: 'Testing standards',
    decision_type: 'process',
    status: 'contradicted',
    decided_at: '2026-10-05',
    decided_by: ['Priya Nair'],
    source_doc_id: 'demo-doc-13',
    source_excerpt: 'Current coverage is 23%. I know this is below the 80% standard set in the Q3 memo but we\'re under deadline pressure for the mobile app launch.',
    rationale: 'Mobile launch deadline (Oct 15) prioritised over coverage threshold — verbal approval from product',
    confidence: 0.91,
  },
]

// ── NEW CONFLICTS ─────────────────────────────────────────────────────────────

const NEW_CONFLICTS: Conflict[] = [
  {
    id: 'demo-conflict-5',
    earlier_decision_id: 'demo-dec-3',
    later_decision_id: 'demo-dec-22',
    conflict_type: 'silent_change',
  },
  {
    id: 'demo-conflict-6',
    earlier_decision_id: 'demo-dec-8',
    later_decision_id: 'demo-dec-22',
    conflict_type: 'silent_change',
  },
  {
    id: 'demo-conflict-7',
    earlier_decision_id: 'demo-dec-21',
    later_decision_id: 'demo-dec-23',
    conflict_type: 'silent_change',
  },
]

export const DEMO_DOCUMENTS_ALL: DLDocument[] = [...DEMO_DOCUMENTS, ...NEW_DOCUMENTS]
export const DEMO_DECISIONS_ALL: Decision[]   = [...DEMO_DECISIONS, ...NEW_DECISIONS]
export const DEMO_CONFLICTS_ALL: Conflict[]   = [...DEMO_CONFLICTS, ...NEW_CONFLICTS]

// ── LIVE DEMO DOCUMENT ────────────────────────────────────────────────────────
// Pre-written PR description — paste this live during a demo to trigger
// real-time extraction + an immediate Auth0 conflict.

export const LIVE_DEMO_DOCUMENT = `## Pull Request #1247
Title: mobile-api: replace Auth0 with Firebase Auth
Author: raj.patel
Date: November 15, 2026
Reviewers: @mobile-lead

## Summary
Switching the mobile-api service authentication from Auth0 to Firebase Auth.

The Auth0 iOS SDK caused 40% slower login times in our React Native benchmark.
Firebase Auth integrates better with React Native and handles push notification
tokens in the same SDK — no separate FCM setup needed.

## Changes
- Replaced Auth0 SDK with Firebase Auth in mobile-api service
- Migrated user sessions to Firebase Authentication tokens
- Firebase project provisioned by mobile team (separate from web project)
- Removed Auth0 dependency from mobile-api package.json
- PKCE flow removed — not applicable to the React Native token model

## Notes
- Only affects mobile-api service, not web platform or admin panel
- Firebase project already running in staging, mobile team spun up their own
- No formal ADR created — mobile team decision for launch velocity

Reviewers: @mobile-lead, @raj.patel`

export function seedDemoData() {
  if (typeof window === 'undefined') return
  localStorage.setItem('dl_documents', JSON.stringify(DEMO_DOCUMENTS_ALL))
  localStorage.setItem('dl_decisions', JSON.stringify(DEMO_DECISIONS_ALL))
  localStorage.setItem('dl_conflicts', JSON.stringify(DEMO_CONFLICTS_ALL))
}
