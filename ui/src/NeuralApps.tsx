import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Globe2,
  Link2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  Waypoints,
} from "lucide-react";
import { managedApi } from "./managed-api";
import { Busy, Code, Field, Head, useAction } from "./shared";
import { managedSite } from "./site";

interface NeuralTemplate {
  id: string;
  title: string;
  tagline: string;
  description: string;
}
interface NeuralDomain {
  hostname: string;
  kind: "subdomain" | "custom";
  status: "active" | "pending";
  url: string | null;
  verifyToken: string;
  records: { type: string; name: string; value: string; ttl?: number }[];
  createdAt: string;
  verifiedAt: string | null;
  lastError: string | null;
}
interface NeuralApp {
  slug: string;
  title: string;
  description: string;
  template: string;
  instance: string;
  session: string | null;
  stream: string | null;
  visibility: "public" | "unlisted";
  state: "live" | "paused";
  release: number;
  views: number;
  url: string;
  subdomainUrl: string;
  pathUrl: string;
  apiBase: string;
  domains: NeuralDomain[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
interface NeuralRelease {
  id: string;
  seq: number;
  config: {
    title: string;
    template: string;
    instance: string;
    session: string | null;
    visibility: string;
  };
  createdAt: string;
  createdBy: string;
}
interface NeuralAppDetail {
  app: NeuralApp;
  releases: NeuralRelease[];
  templates: NeuralTemplate[];
  appDomain: string | null;
}
interface SourceSession {
  instance: string;
  session: string;
  name: string;
  participant: string | null;
  clockDomain: string | null;
  records: number;
  streams: number;
  lastUs: string;
}
interface Sources {
  instances: { id: string; clockDomain: string | null }[];
  sessions: SourceSession[];
  templates: NeuralTemplate[];
  baseDomain: string | null;
  limits: { maxAppsPerProject: number; customDomains: boolean };
}
interface JobSummary {
  state: string;
}
interface NeuralAppsProps {
  embedded?: boolean;
  defaultInstance?: string;
  defaultSession?: string;
}

const EMPTY_FORM = {
  title: "",
  slug: "",
  template: "monitor",
  instance: "",
  session: "",
  description: "",
  visibility: "unlisted" as "public" | "unlisted",
};

const slugOf = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 32)
    .replace(/-+$/g, "");

function shortWhen(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function TemplateArt({ id }: { id: string }) {
  if (id === "decoder")
    return (
      <svg viewBox="0 0 120 64" role="presentation" aria-hidden="true">
        <rect x="10" y="38" width="16" height="16" rx="3" />
        <rect x="32" y="26" width="16" height="28" rx="3" />
        <rect x="54" y="14" width="16" height="40" rx="3" />
        <rect x="76" y="30" width="16" height="24" rx="3" />
        <path d="M10 10h100" />
        <path d="M10 54h100" />
      </svg>
    );
  if (id === "explorer")
    return (
      <svg viewBox="0 0 120 64" role="presentation" aria-hidden="true">
        <circle cx="22" cy="18" r="4" />
        <circle cx="22" cy="32" r="4" />
        <circle cx="22" cy="46" r="4" />
        <path d="M22 18h78M22 32h58M22 46h70" />
        <path d="M22 18l0 28" />
      </svg>
    );
  return (
    <svg viewBox="0 0 120 64" role="presentation" aria-hidden="true">
      <path d="M6 32c8 0 8-18 16-18s8 34 16 34 8-28 16-28 8 20 16 20 8-12 16-12 8 8 16 8" />
      <path d="M6 46h108M6 18h108" />
      <circle cx="70" cy="14" r="2.5" />
    </svg>
  );
}

function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost neural-copy"
      aria-label={label + " " + value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function editOf(app: NeuralApp) {
  return {
    title: app.title,
    description: app.description,
    template: app.template,
    instance: app.instance,
    session: app.session ?? "",
    visibility: app.visibility,
  };
}

export default function NeuralApps({
  embedded = false,
  defaultInstance,
  defaultSession,
}: NeuralAppsProps) {
  const pageAction = useAction();
  const detailAction = useAction();
  const createAction = useAction();
  const publishAction = useAction();
  const domainAction = useAction();
  const [loaded, setLoaded] = useState(false);
  const [apps, setApps] = useState<NeuralApp[]>([]);
  const [templates, setTemplates] = useState<NeuralTemplate[]>([]);
  const [appDomain, setAppDomain] = useState<string | null>(null);
  const [limits, setLimits] = useState({
    maxAppsPerProject: 10,
    customDomains: true,
  });
  const [sources, setSources] = useState<Sources | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<NeuralAppDetail | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [slugTouched, setSlugTouched] = useState(false);
  const [edit, setEdit] = useState({
    title: "",
    description: "",
    template: "monitor",
    instance: "",
    session: "",
    visibility: "unlisted" as "public" | "unlisted",
  });
  const [hostname, setHostname] = useState("");
  const [instructions, setInstructions] = useState<string[]>([]);

  const sessionsForInstance = useMemo(
    () =>
      (sources?.sessions ?? []).filter(
        (entry) => !form.instance || entry.instance === form.instance,
      ),
    [sources, form.instance],
  );
  const editSessions = useMemo(
    () =>
      (sources?.sessions ?? []).filter(
        (entry) => !edit.instance || entry.instance === edit.instance,
      ),
    [sources, edit.instance],
  );
  const activeTemplate = templates.find((entry) => entry.id === form.template);
  const recorded = sources?.sessions.length ?? 0;
  const trained = jobs.filter((job) => job.state === "succeeded").length;
  const steps = [
    {
      key: "connect",
      title: "Connect",
      text: "BrainFlow board, LSL stream or the synthetic board",
      done: recorded > 0,
    },
    {
      key: "record",
      title: "Record",
      text: "A session with channels, cues and quality",
      done: recorded > 0,
    },
    {
      key: "train",
      title: "Train",
      text: "A frozen dataset and decoder run",
      done: trained > 0,
    },
    {
      key: "publish",
      title: "Publish",
      text: "A URL, a domain and a read-only API",
      done: apps.length > 0,
    },
  ];

  async function detailOf(slug: string) {
    const result = await managedApi<NeuralAppDetail>(
      "/managed/neuro-apps/" + encodeURIComponent(slug),
    );
    setSelected(slug);
    setDetail(result);
    setEdit(editOf(result.app));
    setInstructions([]);
    return result;
  }

  async function refresh(preferred?: string) {
    const list = await managedApi<{
      apps: NeuralApp[];
      templates: NeuralTemplate[];
      appDomain: string | null;
      limits: { maxAppsPerProject: number; customDomains: boolean };
    }>("/managed/neuro-apps");
    setApps(list.apps);
    if (list.templates?.length) setTemplates(list.templates);
    setAppDomain(list.appDomain);
    if (list.limits) setLimits(list.limits);
    let sourceValue: Sources | null = null;
    try {
      sourceValue = await managedApi<Sources>("/managed/neuro-apps/sources");
      setSources(sourceValue);
      setSourceError("");
      if (sourceValue.templates?.length) setTemplates(sourceValue.templates);
      if (!form.instance && sourceValue.instances[0]) {
        const instance = defaultInstance || sourceValue.instances[0].id;
        const first = sourceValue.sessions.find(
          (entry) => entry.instance === instance,
        );
        setForm((current) => ({
          ...current,
          instance,
          session:
            current.session ||
            (defaultInstance === instance ? defaultSession : "") ||
            first?.session ||
            "",
        }));
      }
    } catch (error) {
      setSources(null);
      setSourceError(
        error instanceof Error
          ? error.message
          : "The project's recordings could not be read.",
      );
    }
    try {
      const value = await managedApi<{ jobs?: JobSummary[] }>(
        "/managed/bci/jobs",
      );
      setJobs(value.jobs ?? []);
    } catch {
      setJobs([]);
    }
    const wanted =
      preferred && list.apps.some((entry) => entry.slug === preferred)
        ? preferred
        : selected && list.apps.some((entry) => entry.slug === selected)
          ? selected
          : (list.apps[0]?.slug ?? "");
    if (wanted) await detailOf(wanted);
    else {
      setSelected("");
      setDetail(null);
    }
    setLoaded(true);
  }

  useEffect(() => {
    if (!managedSite) return;
    void pageAction.run(async () => {
      try {
        await refresh();
      } finally {
        setLoaded(true);
      }
    });
  }, []);

  function changeInstance(instance: string) {
    const first = sources?.sessions.find(
      (entry) => entry.instance === instance,
    );
    setForm((current) => ({
      ...current,
      instance,
      session: first?.session ?? "",
    }));
  }

  function publishApp() {
    const title = form.title.trim();
    if (!title || !form.instance || !form.session) return;
    void createAction.run(async () => {
      const result = await managedApi<{ app: NeuralApp }>(
        "/managed/neuro-apps/create",
        {
          title,
          slug: form.slug.trim() || slugOf(title),
          template: form.template,
          description: form.description.trim(),
          instance: form.instance,
          session: form.session,
          visibility: form.visibility,
        },
      );
      await refresh(result.app.slug);
      setForm({ ...EMPTY_FORM, instance: form.instance });
      setSlugTouched(false);
    }, "App published. Open the URL or attach a domain.");
  }

  function publishRelease() {
    if (!detail) return;
    void publishAction.run(async () => {
      await managedApi("/managed/neuro-apps/publish", {
        slug: detail.app.slug,
        ...edit,
      });
      await refresh(detail.app.slug);
    }, "New release published.");
  }

  function changeState(next: "live" | "paused") {
    if (!detail) return;
    void detailAction.run(
      async () => {
        await managedApi("/managed/neuro-apps/state", {
          slug: detail.app.slug,
          state: next,
        });
        await refresh(detail.app.slug);
      },
      next === "live" ? "App is live." : "App is offline.",
    );
  }

  function removeApp() {
    if (!detail) return;
    if (
      !window.confirm(
        "Delete " +
          detail.app.title +
          " and its " +
          detail.app.domains.length +
          " address(es)? This cannot be undone.",
      )
    )
      return;
    void detailAction.run(async () => {
      await managedApi("/managed/neuro-apps/delete", {
        slug: detail.app.slug,
        confirm: detail.app.slug,
      });
      await refresh();
    }, "App deleted.");
  }

  function addDomain() {
    if (!detail || !hostname.trim()) return;
    void domainAction.run(async () => {
      const result = await managedApi<{
        domain: NeuralDomain;
        instructions: string[];
      }>("/managed/neuro-apps/domains/add", {
        slug: detail.app.slug,
        hostname: hostname.trim(),
      });
      setInstructions(result.instructions);
      setHostname("");
      await detailOf(detail.app.slug);
      setInstructions(result.instructions);
    }, "Domain added. Create the DNS records, then verify.");
  }

  function verifyDomain(value: string) {
    if (!detail) return;
    void domainAction.run(async () => {
      await managedApi("/managed/neuro-apps/domains/verify", {
        slug: detail.app.slug,
        hostname: value,
      });
      await detailOf(detail.app.slug);
    }, "Domain verified. The app is served on that address.");
  }

  function removeDomain(value: string) {
    if (!detail) return;
    if (!window.confirm("Remove the custom domain " + value + "?")) return;
    void domainAction.run(async () => {
      await managedApi("/managed/neuro-apps/domains/remove", {
        slug: detail.app.slug,
        hostname: value,
      });
      await detailOf(detail.app.slug);
    }, "Domain removed.");
  }

  if (!managedSite)
    return (
      <section className="panel form-panel">
        <h2>Publishing is available on chronodb.co</h2>
        <p>
          A Community installation keeps its recordings on your own machine. Use
          the BCI workspace there, or create a hosted project to publish a URL.
        </p>
      </section>
    );

  if (!loaded)
    return (
      <p className="empty-table" role="status">
        Reading published apps…
      </p>
    );

  const app = detail?.app ?? null;
  const canCreate = Boolean(sources?.sessions.length);
  const atLimit = apps.length >= limits.maxAppsPerProject;

  return (
    <div className={"neural-publish" + (embedded ? " embedded" : "")}>
      {!embedded && (
        <Head
          title="Publish"
          text="Publish a read-only neural app for a recording. You get a chronodb.co subdomain, an optional custom domain and a documented read-only API. No container or deploy step is needed."
        >
          <button
            className="ghost"
            onClick={() => void pageAction.run(async () => refresh())}
            disabled={pageAction.busy}
          >
            <RefreshCw size={16} /> <Busy busy={pageAction.busy}>Refresh</Busy>
          </button>
        </Head>
      )}
      {embedded && (
        <div className="neural-embedded-head">
          <div>
            <p className="bci-eyebrow">PUBLISH</p>
            <h2>Turn this recording into a URL</h2>
            <p>
              A hosted, read-only app with its own subdomain and API. The
              recording stays in this project.
            </p>
          </div>
          <button
            className="ghost"
            onClick={() => void pageAction.run(async () => refresh())}
            disabled={pageAction.busy}
          >
            <RefreshCw size={16} /> <Busy busy={pageAction.busy}>Refresh</Busy>
          </button>
        </div>
      )}
      {pageAction.feedback}
      <section className="neural-lifecycle" aria-label="Product cycle">
        {steps.map((step, index) => (
          <div
            className={"neural-step" + (step.done ? " done" : "")}
            key={step.key}
          >
            <span className="neural-step-index">
              {step.done ? <Check size={13} /> : index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </div>
            {!step.done &&
              (step.key === "connect" || step.key === "record") && (
                <Link to="/app/bci" className="neural-step-link">
                  Open BCI <ArrowRight size={13} />
                </Link>
              )}
          </div>
        ))}
      </section>

      <section className="panel form-panel">
        <div className="section-head">
          <div>
            <h2>
              <Globe2 size={18} /> Your neural apps
            </h2>
            <p className="small muted">
              Each app is a reviewed template over one recording. Its project
              token never reaches the browser.
            </p>
          </div>
          {appDomain && <span className="scope-badge">*.{appDomain}</span>}
        </div>
        {apps.length === 0 ? (
          <p className="empty-table">
            No app yet. Choose a template below and publish your first URL.
          </p>
        ) : (
          <div className="neural-grid">
            {apps.map((entry) => (
              <button
                type="button"
                key={entry.slug}
                className={
                  "neural-card" + (entry.slug === selected ? " selected" : "")
                }
                aria-current={entry.slug === selected}
                onClick={() =>
                  void detailAction.run(async () => {
                    await detailOf(entry.slug);
                  })
                }
              >
                <span className="neural-art">
                  <TemplateArt id={entry.template} />
                </span>
                <span className="neural-card-body">
                  <span className="neural-card-kicker">
                    {templates.find((t) => t.id === entry.template)?.title ??
                      entry.template}
                  </span>
                  <strong>{entry.title}</strong>
                  <code>{new URL(entry.url).host}</code>
                  <span className="neural-badges">
                    <span
                      className={
                        "neural-status " +
                        (entry.state === "live" ? "live" : "paused")
                      }
                    >
                      {entry.state === "live" ? "Live" : "Offline"}
                    </span>
                    <span className="neural-meta">release {entry.release}</span>
                    <span className="neural-meta">{entry.views} views</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {app && detail && (
        <section className="panel form-panel neural-detail">
          <div className="section-head">
            <div>
              <h2>{app.title}</h2>
              <p className="small muted">
                {app.description || "No description."}
              </p>
            </div>
            <span
              className={
                "neural-status " + (app.state === "live" ? "live" : "paused")
              }
            >
              {app.state === "live" ? "Live" : "Offline"}
            </span>
          </div>
          <div className="neural-urlrow">
            <span className="neural-url">
              <Link2 size={15} />
              <a href={app.url} target="_blank" rel="noreferrer noopener">
                {app.url}
              </a>
            </span>
            <CopyButton value={app.url} label="Copy URL" />
            <a
              className="button outline neural-open"
              href={app.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={15} /> Open app
            </a>
          </div>
          <p className="small muted neural-pathline">
            Preview on this origin:{" "}
            <a href={app.pathUrl} target="_blank" rel="noreferrer noopener">
              {app.pathUrl}
            </a>
            {" · "}
            {app.views} page view{app.views === 1 ? "" : "s"} · release{" "}
            {app.release} · updated {shortWhen(app.updatedAt)}
          </p>
          {detailAction.feedback}

          <h3 className="neural-h3">Publish a new release</h3>
          <p className="small muted">
            A release is a frozen description of the app: its title, template
            and recording. Publishing again never changes the recording.
          </p>
          {publishAction.feedback}
          <div className="managed-two-column">
            <Field label="Title">
              <input
                value={edit.title}
                maxLength={80}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </Field>
            <Field label="Template" hint="Choose what the app shows.">
              <select
                value={edit.template}
                onChange={(e) => setEdit({ ...edit, template: e.target.value })}
              >
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Instance">
              <select
                value={edit.instance}
                onChange={(e) => {
                  const instance = e.target.value;
                  const first = sources?.sessions.find(
                    (entry) => entry.instance === instance,
                  );
                  setEdit({ ...edit, instance, session: first?.session ?? "" });
                }}
              >
                {(
                  sources?.instances ?? [
                    { id: app.instance, clockDomain: null },
                  ]
                ).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recording">
              <select
                value={edit.session}
                onChange={(e) => setEdit({ ...edit, session: e.target.value })}
              >
                {edit.session &&
                  !editSessions.some(
                    (entry) => entry.session === edit.session,
                  ) && (
                    <option value={edit.session}>
                      Recording {edit.session}
                    </option>
                  )}
                {editSessions.map((entry) => (
                  <option key={entry.session} value={entry.session}>
                    {entry.name} · {entry.session}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Visibility"
              hint="Unlisted is not indexed by search engines."
            >
              <select
                value={edit.visibility}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    visibility: e.target.value as "public" | "unlisted",
                  })
                }
              >
                <option value="unlisted">Unlisted</option>
                <option value="public">Public and indexable</option>
              </select>
            </Field>
            <Field label="Description">
              <input
                value={edit.description}
                maxLength={280}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="table-actions">
            <button
              className="primary"
              onClick={publishRelease}
              disabled={publishAction.busy || !edit.title.trim()}
            >
              <Busy busy={publishAction.busy}>Publish release</Busy>
            </button>
            <button
              className="outline"
              onClick={() =>
                changeState(app.state === "live" ? "paused" : "live")
              }
              disabled={detailAction.busy}
            >
              {app.state === "live" ? (
                <>
                  <Pause size={15} /> Take offline
                </>
              ) : (
                <>
                  <Play size={15} /> Bring online
                </>
              )}
            </button>
            <button
              className="ghost danger"
              onClick={removeApp}
              disabled={detailAction.busy}
            >
              <Trash2 size={15} /> Delete app
            </button>
          </div>

          <h3 className="neural-h3">
            <Waypoints size={16} /> Domains
          </h3>
          <p className="small muted">
            Every app gets{" "}
            <code>{app.subdomainUrl.replace("https://", "")}</code>. A custom
            domain needs a CNAME and a TXT record, and becomes routable only
            after both verify.
          </p>
          {domainAction.feedback}
          <div className="neural-domains">
            {app.domains.map((domain) => (
              <div className="neural-domain" key={domain.hostname}>
                <div>
                  <strong>{domain.hostname}</strong>
                  <span className={"neural-status " + domain.status}>
                    {domain.status}
                  </span>
                  {domain.kind === "subdomain" && (
                    <span className="neural-meta">platform address</span>
                  )}
                  {domain.lastError && (
                    <p className="small muted">{domain.lastError}</p>
                  )}
                </div>
                <div className="neural-domain-actions">
                  {domain.status === "active" && domain.url && (
                    <a
                      className="button ghost"
                      href={domain.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open
                    </a>
                  )}
                  {domain.kind === "custom" && (
                    <>
                      <button
                        className="button ghost"
                        disabled={domainAction.busy}
                        onClick={() => verifyDomain(domain.hostname)}
                      >
                        Verify
                      </button>
                      <button
                        className="button ghost danger"
                        disabled={domainAction.busy}
                        onClick={() => removeDomain(domain.hostname)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {limits.customDomains && (
            <div className="neural-domain-add">
              <Field
                label="Custom domain"
                hint="For example app.yourlab.com. Use a domain you control."
              >
                <input
                  value={hostname}
                  placeholder="app.yourlab.com"
                  onChange={(e) => setHostname(e.target.value)}
                />
              </Field>
              <button
                className="outline"
                disabled={domainAction.busy || !hostname.trim()}
                onClick={addDomain}
              >
                <Plus size={15} /> Add domain
              </button>
            </div>
          )}
          {instructions.length > 0 && (
            <div className="notice">
              <strong>DNS records</strong>
              <ol className="neural-instructions">
                {instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <p className="small muted">
                DNS changes can take minutes. Press Verify after the records are
                visible.
              </p>
            </div>
          )}

          <h3 className="neural-h3">
            <Activity size={16} /> Read-only API
          </h3>
          <p className="small muted">
            The app and your own tools read through this endpoint. It accepts
            only reads, only this app's instance, and only its recording.
          </p>
          <div className="neural-api">
            <code>{app.apiBase}</code>
            <CopyButton value={app.apiBase} label="Copy API" />
          </div>
          <div className="neural-api-list">
            <span>
              <code>GET /sessions</code> recordings in this app's scope
            </span>
            <span>
              <code>GET /session?session=ID</code> metadata and stream geometry
            </span>
            <span>
              <code>GET /records?session=ID&type=event</code> events, gaps,
              datasets and runs
            </span>
            <span>
              <code>GET /window?session=ID&stream=ID&start=US&end=US</code>{" "}
              envelopes, at most 60 seconds
            </span>
            <span>
              <code>GET /info</code> this app's public description
            </span>
          </div>
          <Code
            text={
              "curl " +
              app.apiBase +
              "/sessions\n\ncurl '" +
              app.apiBase +
              "/window?session=" +
              (app.session ?? "SESSION") +
              "&start=LAST_US-10000000&end=LAST_US&points=400'  # last_us comes from /sessions"
            }
          />

          <h3 className="neural-h3">Embed this app</h3>
          <p className="small muted">
            The page allows framing. Use the live URL, not the preview path, in
            another site.
          </p>
          <Code
            text={
              '<iframe src="' +
              app.url +
              '" title="' +
              app.title.replaceAll('"', "&quot;") +
              '" style="width:100%;height:720px;border:0" loading="lazy"></iframe>'
            }
          />

          <h3 className="neural-h3">Release history</h3>
          <div className="table-scroll">
            <table className="managed-table">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>When</th>
                  <th>Template</th>
                  <th>Recording</th>
                  <th>Title</th>
                </tr>
              </thead>
              <tbody>
                {detail.releases.map((release) => (
                  <tr key={release.id}>
                    <td>{release.seq}</td>
                    <td>{shortWhen(release.createdAt)}</td>
                    <td>{release.config.template}</td>
                    <td>
                      <code>{release.config.session ?? "—"}</code>
                    </td>
                    <td>{release.config.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel form-panel neural-create">
        <div className="section-head">
          <div>
            <h2>
              <Rocket size={18} /> Create a neural app
            </h2>
            <p className="small muted">
              The app is served from this deployment. Nothing is installed and
              no container is started.
            </p>
          </div>
        </div>
        {createAction.feedback}
        {sourceError && (
          <div className="notice error" role="alert">
            <strong>Recordings could not be read.</strong>
            <p>{sourceError}</p>
          </div>
        )}
        {!canCreate && !sourceError && (
          <div className="notice">
            <strong>Record a session first.</strong>
            <p>
              Publishing needs a recorded session.{" "}
              <Link to="/app/bci">Open the BCI workspace</Link> to connect a
              board, record a run or use the synthetic board.
            </p>
          </div>
        )}
        <div
          className="neural-template-grid"
          role="radiogroup"
          aria-label="Template"
        >
          {templates.map((entry) => (
            <button
              type="button"
              role="radio"
              aria-checked={form.template === entry.id}
              key={entry.id}
              className={
                "neural-template" +
                (form.template === entry.id ? " selected" : "")
              }
              onClick={() => setForm({ ...form, template: entry.id })}
            >
              <span className="neural-art">
                <TemplateArt id={entry.id} />
              </span>
              <strong>{entry.title}</strong>
              <span>{entry.tagline}</span>
              <p>{entry.description}</p>
            </button>
          ))}
        </div>
        <div className="managed-two-column">
          <Field label="App title" hint="The heading on the published page.">
            <input
              value={form.title}
              maxLength={80}
              placeholder="Motor imagery live"
              onChange={(e) => {
                const title = e.target.value;
                setForm({
                  ...form,
                  title,
                  ...(slugTouched ? {} : { slug: slugOf(title) }),
                });
              }}
            />
          </Field>
          <Field
            label="URL name"
            hint={
              appDomain
                ? "Your app becomes " + (form.slug || "name") + "." + appDomain
                : "3–32 lowercase letters, digits and dashes; start with a letter, end with a letter or digit."
            }
          >
            <div className="neural-slug">
              <input
                value={form.slug}
                maxLength={32}
                placeholder="motor-live"
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm({ ...form, slug: slugOf(e.target.value) });
                }}
              />
              {appDomain && <span>.{appDomain}</span>}
            </div>
          </Field>
          <Field label="Recording instance">
            <select
              value={form.instance}
              disabled={!sources?.instances.length}
              onChange={(e) => changeInstance(e.target.value)}
            >
              <option value="">Choose an instance</option>
              {(sources?.instances ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recording">
            <select
              value={form.session}
              disabled={!sessionsForInstance.length}
              onChange={(e) => setForm({ ...form, session: e.target.value })}
            >
              <option value="">Choose a recording</option>
              {sessionsForInstance.map((entry) => (
                <option key={entry.session} value={entry.session}>
                  {entry.name} · {entry.session} · {entry.records} records
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Visibility"
            hint="Unlisted keeps the page out of search engines."
          >
            <select
              value={form.visibility}
              onChange={(e) =>
                setForm({
                  ...form,
                  visibility: e.target.value as "public" | "unlisted",
                })
              }
            >
              <option value="unlisted">Unlisted</option>
              <option value="public">Public and indexable</option>
            </select>
          </Field>
          <Field
            label="Description"
            hint="One sentence for the page and social preview."
          >
            <input
              value={form.description}
              maxLength={280}
              placeholder="A live view of one motor-imagery recording."
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
        </div>
        {activeTemplate && (
          <p className="neural-selected">
            <ShieldCheck size={15} /> {activeTemplate.title}: read-only{" "}
            {activeTemplate.id === "decoder"
              ? "decoder results"
              : activeTemplate.id === "explorer"
                ? "timeline"
                : "signal"}{" "}
            for this recording.
          </p>
        )}
        <div className="table-actions">
          <button
            className="primary"
            disabled={
              createAction.busy ||
              !canCreate ||
              atLimit ||
              !form.title.trim() ||
              !form.slug.trim() ||
              !form.instance ||
              !form.session
            }
            onClick={publishApp}
          >
            <Busy busy={createAction.busy}>Publish app</Busy>
          </button>
          {atLimit && (
            <span className="small muted">
              This project has reached {limits.maxAppsPerProject} apps.
            </span>
          )}
        </div>
      </section>

      <section className="panel form-panel neural-explainer">
        <h2>
          <Radio size={18} /> What runs where
        </h2>
        <div className="neural-explainer-grid">
          <div>
            <strong>Your hardware</strong>
            <p>
              BrainFlow, LSL or the synthetic board writes into your project
              through the recording contract. ChronoDB does not open the device
              for you.
            </p>
          </div>
          <div>
            <strong>Your project</strong>
            <p>
              Raw samples, events and decoder runs stay in the project's own
              engine and durable storage.
            </p>
          </div>
          <div>
            <strong>The published app</strong>
            <p>
              A read-only document served by this deployment. It calls the app
              API; the project token stays on the server.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
