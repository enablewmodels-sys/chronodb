# Publish BCI web apps

ChronoDB can turn a recorded and trained BCI session into a hosted, read-only web app.
The app has its own address, an optional custom domain, and a documented read-only API.
Nothing is installed on your machine and no container is started.

The complete cycle is one workspace:

1. **Connect** a BrainFlow board, an LSL stream or the synthetic board.
2. **Record** a session. Raw samples, source timestamps, gaps and events stay in the
   project.
3. **Train** a decoder on a frozen dataset, or publish results from your own decoder.
4. **Publish** the recording as a web app at `<name>.chronodb.co` or your own domain.

Open **Publish apps** in the console, or the **Publish** tab inside **BCI workspace**.
The BCI tab carries the selected recording into the publish form.

## Create an app

1. Choose a template: **Signal monitor**, **Decoder dashboard** or **Session explorer**.
2. Choose the recording instance and the recording. An app is scoped to that one
   recording; it cannot read another.
3. Choose a URL name. The app becomes `<url-name>.chronodb.co` (or
   `https://chronodb.co/a/<url-name>` on a development deployment without a domain).
4. Choose **Unlisted** (default) or **Public**. Unlisted pages send `noindex` and a
   `Disallow` robots file. It is a search-engine setting, not access control: anyone
   with the URL can open either kind.
5. Press **Publish app**. The app is live at once. There is no build, queue or deploy
   step.

A release is a frozen description of the app: title, description, template, instance
and recording. **Publish release** writes a new numbered release. The release history
keeps the previous descriptions; raw recordings are never changed.

## Addresses

| Address | Meaning |
| --- | --- |
| `https://<name>.<appDomain>` | The app's platform subdomain. `appDomain` defaults to the deployment's own hostname, for example `chronodb.co`. |
| `https://<origin>/a/<name>` | A path preview on the console origin. Useful before DNS is ready. |
| `https://<custom-domain>` | Added by you, with a CNAME and a TXT record. Routable only after both verify. |
| `https://<origin>/apps-api/<name>/v1` | The app's read-only API. It also answers on the app hostname. |

Slugs are 3–32 lowercase letters, digits and dashes. They start with a letter, end
with a letter or a digit, and are globally unique. Platform names such as `www`, `api`, `admin`, `bci` and `status`
are reserved. A project may publish ten apps by default.

## Custom domains

Add a domain in the app's **Domains** panel. ChronoDB returns two records:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `app.yourlab.com` | `chronodb.co` (or `<name>.<appDomain>`) |
| TXT | `_chronodb-verify.app.yourlab.com` | the verification value shown in the console |

Keep both records in place and press **Verify**. Verification checks:
- the TXT value matches this app's token; and
- the CNAME points at `chronodb.co` or `<name>.<appDomain>`. An A or AAAA record
  alone is not accepted, because it proves only that some server exists at that
  address.

A domain that verified once stays routable if a later check fails, so a temporary DNS
mistake does not take a published app offline. Remove the domain explicitly to stop
serving it.

The deployment needs a wildcard route and on-demand TLS for custom hostnames. See
[operations](#deployment) below.

## Read-only API

Every app exposes a bounded projection of its own recording. The project API token
never reaches the browser.

```sh
BASE=https://<name>.chronodb.co/apps-api/<name>/v1

curl "$BASE/info"
curl "$BASE/sessions"
curl "$BASE/session?session=RECORDING"
curl "$BASE/records?session=RECORDING&type=event&limit=100"
# start and end are in the recording's own clock. Read last_us from /sessions first.
curl "$BASE/window?session=RECORDING&stream=eeg&start=LAST_US-10000000&end=LAST_US&points=600&channels=0,1,2,3"
```

| Endpoint | Returns | Limits |
| --- | --- | --- |
| `GET /info` | The app's public description and endpoint list | — |
| `GET /health` | A liveness answer | — |
| `GET /sessions` | Recordings in the app's instance, filtered to its recording | 100 |
| `GET /session?session=ID` | Session metadata and stream geometry | one recording |
| `GET /records?session=ID&type=TYPE` | Events, gaps, datasets and decoder runs | 200 per page |
| `GET /window?session=ID&stream=ID&start=US&end=US` | Min/mean/max envelopes and events | 60 seconds, 16 channels, 2,048 points |

- Only `GET`, `HEAD` and `OPTIONS` are accepted. There is no write operation.
- The instance and recording are forced from the app record. A request for another
  recording answers `403`, even when that recording belongs to the same project.
- The API sends `Access-Control-Allow-Origin: *` because the data is already public
  to anyone with the app URL. Do not publish a recording that contains personal or
  clinical data you are not allowed to disclose.
- A public app is rate-limited per app and client address.

### Embed the app

The page may be framed:

```html
<iframe
  src="https://<name>.<appDomain>"
  title="Motor imagery live"
  style="width:100%;height:720px;border:0"
></iframe>
```

## Templates

| Template | What it shows |
| --- | --- |
| Signal monitor | Waveform envelopes for up to eight channels, cue and gap markers, follow-latest and 5/10/30-second windows |
| Decoder dashboard | Balanced accuracy, evaluation epochs, training and held-out recording counts, confusion matrix and run details |
| Session explorer | Session metadata, stream geometry and a filterable timeline of events, gaps, datasets and runs |

A template is a self-contained document. It uses no external script, font or image.
The page runs under a content-security policy that allows only its own inline code and
same-origin API calls.

## What this is not

- It is not a write API and it cannot control a device. Feedback and stimulation are
  outside the published surface.
- It is not a clinical or diagnostic product. A high decoder score on a synthetic or
  short recording shows the pipeline works; it does not establish performance on a
  person or a device.
- It does not make an unlisted app private. Unlisted only asks search engines to stay
  away.
- A custom domain is a DNS fact, not a brand verification. Use a domain you control.

## Deployment

The feature needs no container runtime. It reads and writes the control-plane
database and serves the app from the managed process.

Optional configuration:

```json
{
  "publishing": {
    "appDomain": "chronodb.co",
    "maxAppsPerProject": 10,
    "customDomains": true
  }
}
```

- `appDomain` defaults to the deployment origin's hostname unless that is a loopback
  address or an IP. Set it to `null` to use path URLs only.
- Every subdomain and custom domain must resolve to the deployment and reach the
  control plane with its original `Host` header.

For `chronodb.co`, create one wildcard record at the DNS provider (Cloudflare):

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `*` | the deployment's public IPv4 address | Proxied |

Without that record, `<name>.chronodb.co` does not resolve. The path address
`https://chronodb.co/a/<name>` keeps working, but it is not the subdomain the
product promises. Check the record before announcing the subdomain:

```sh
dig +short test.chronodb.co
```

Caddy needs a route for app hostnames and on-demand TLS. The repository's
`launch/private/managed/Caddyfile.chronodb` carries this shape:

```caddy
{
  on_demand_tls {
    ask http://127.0.0.1:8090/internal/tls-allow
  }
}

*.chronodb.co {
  tls { on_demand }
  reverse_proxy 127.0.0.1:8090
}

:443 {
  tls { on_demand }
  reverse_proxy 127.0.0.1:8090
}
```

`/internal/tls-allow` answers 200 only for a live platform subdomain or a verified
custom domain. An unknown hostname gets 404, so Caddy does not obtain a certificate
for it. DNS for `*.chronodb.co` must point at the deployment; a custom domain points
at `chronodb.co` or `<name>.chronodb.co` with its CNAME. The apex target works even
before a wildcard record exists.

Operators can inspect or correct the tables directly:

```sh
sqlite3 /var/lib/chronograph-managed/identity.sqlite \
  'SELECT slug,project_id,state,views FROM cg_neuro_app ORDER BY created_at DESC;'
sqlite3 /var/lib/chronograph-managed/identity.sqlite \
  'SELECT hostname,app_slug,status,last_error FROM cg_neuro_domain;'
```

## Troubleshooting

| Symptom | Cause and next step |
| --- | --- |
| The app says "This app address is not active" | The app is paused or the custom domain has not verified. Bring it online or check both DNS records. |
| Verify says the TXT record is missing | DNS has not propagated, or the record name is wrong. It is `_chronodb-verify.<your-domain>`. |
| Verify says the CNAME points elsewhere | Change the CNAME to `chronodb.co` or `<name>.<appDomain>`. Do not put a path or a wildcard in it. |
| The subdomain does not resolve | Add a wildcard DNS record for `*.<appDomain>` and route it to the deployment. |
| The page opens but shows no data | The recording may have no samples in the visible window, or the app is scoped to another recording. Open the API `/sessions` answer. |
| The app API answers 403 | The request names another recording. A published app is scoped to one recording. |