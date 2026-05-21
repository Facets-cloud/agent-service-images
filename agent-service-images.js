class AgentServiceImages extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.projects = ['capillary-cloud', 'fcp', 'saas-cp'];
    this.projectState = {};
    for (const p of this.projects) {
      this.projectState[p] = { phase: 'loading', rows: [], error: null };
    }

    this.render();
  }

  connectedCallback() {
    for (const project of this.projects) {
      this.loadProject(project);
    }
  }

  async loadProject(project) {
    const state = this.projectState[project];
    try {
      const resp = await fetch(
        `/cc-ui/v1/stacks/${encodeURIComponent(project)}/clusters`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status} listing environments`);
      const clusters = await resp.json();

      state.rows = (clusters || []).map((c) => ({
        clusterId: c.id,
        envName: c.name,
        releaseStream: c.releaseStream || '',
        repo: '',
        tag: '',
        image: '',
        status: 'loading',
        error: null,
      }));
      state.phase = 'loaded';
      this.renderProject(project);

      await Promise.all(
        state.rows.map((row) => this.loadEnvImage(project, row.clusterId))
      );
    } catch (e) {
      state.phase = 'error';
      state.error = e.message;
      this.renderProject(project);
    }
  }

  async loadEnvImage(project, clusterId) {
    const state = this.projectState[project];
    const row = state.rows.find((r) => r.clusterId === clusterId);
    if (!row) return;

    try {
      const podsResp = await fetch(
        `/cc-ui/v1/clusters/${encodeURIComponent(clusterId)}/k8s-explorer/pods?resourceName=agent&resourceType=service`
      );
      if (!podsResp.ok) throw new Error(`HTTP ${podsResp.status} listing pods`);
      const pods = await podsResp.json();

      if (!pods || pods.length === 0) {
        row.status = 'not-deployed';
        this.renderRow(project, clusterId);
        return;
      }

      const pod = pods.find((p) => p.status === 'Running') || pods[0];

      const cResp = await fetch(
        `/cc-ui/v1/clusters/${encodeURIComponent(clusterId)}/k8s-explorer/${encodeURIComponent(pod.name)}/v2/containers`
      );
      if (!cResp.ok) throw new Error(`HTTP ${cResp.status} listing containers`);
      const containers = await cResp.json();

      const agent =
        (containers || []).find((c) => c.name === 'agent') ||
        (containers || [])[0];
      if (!agent || !agent.image) {
        row.status = 'no-image';
        this.renderRow(project, clusterId);
        return;
      }

      const [repo, tag] = this.splitImage(agent.image);
      row.image = agent.image;
      row.repo = repo;
      row.tag = tag;
      row.status = pod.status === 'Running' ? 'running' : pod.status.toLowerCase();
      this.renderRow(project, clusterId);
    } catch (e) {
      row.status = 'error';
      row.error = e.message;
      this.renderRow(project, clusterId);
    }
  }

  splitImage(image) {
    const atIdx = image.indexOf('@');
    if (atIdx !== -1) return [image.slice(0, atIdx), image.slice(atIdx + 1)];
    const colonIdx = image.lastIndexOf(':');
    const slashIdx = image.lastIndexOf('/');
    if (colonIdx !== -1 && colonIdx > slashIdx) {
      return [image.slice(0, colonIdx), image.slice(colonIdx + 1)];
    }
    return [image, ''];
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #1f2328;
          --primary: #0969da;
          --border: #d0d7de;
          --muted: #656d76;
          --bg-subtle: #f6f8fa;
          --surface: #ffffff;
          --success: #1a7f37;
          --warn: #9a6700;
          --danger: #cf222e;
          --badge-running-bg: #dafbe1;
          --badge-loading-bg: #ddf4ff;
          --badge-not-deployed-bg: #f6f8fa;
          --badge-no-image-bg: #fff8c5;
          --badge-error-bg: #ffebe9;
          --badge-other-bg: #fff8c5;
          --stream-bg: #eaeef2;
          --stream-prod-bg: #ffebe9;
          --stream-staging-bg: #fff8c5;
          --stream-qa-bg: #ddf4ff;
          --err-bg: #ffebe9;
        }
        @media (prefers-color-scheme: dark) {
          :host {
            color: #e6edf3;
            --primary: #2f81f7;
            --border: #30363d;
            --muted: #8b949e;
            --bg-subtle: #161b22;
            --surface: transparent;
            --success: #3fb950;
            --warn: #d29922;
            --danger: #f85149;
            --badge-running-bg: rgba(63, 185, 80, 0.15);
            --badge-loading-bg: rgba(47, 129, 247, 0.15);
            --badge-not-deployed-bg: rgba(139, 148, 158, 0.15);
            --badge-no-image-bg: rgba(210, 153, 34, 0.15);
            --badge-error-bg: rgba(248, 81, 73, 0.15);
            --badge-other-bg: rgba(210, 153, 34, 0.15);
            --stream-bg: rgba(139, 148, 158, 0.18);
            --stream-prod-bg: rgba(248, 81, 73, 0.18);
            --stream-staging-bg: rgba(210, 153, 34, 0.18);
            --stream-qa-bg: rgba(47, 129, 247, 0.18);
            --err-bg: rgba(248, 81, 73, 0.12);
          }
        }
        .root { padding: 1rem 1.25rem; max-width: 1400px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        h1 { font-size: 1.25rem; margin: 0; }
        .refresh {
          background: var(--primary); color: #fff; border: 0; border-radius: 6px;
          padding: 0.5rem 0.9rem; cursor: pointer; font-size: 0.875rem;
        }
        .refresh:hover { filter: brightness(0.95); }
        .project { margin-bottom: 1.75rem; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
        .project-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.65rem 1rem; background: var(--bg-subtle); border-bottom: 1px solid var(--border);
          font-weight: 600;
        }
        .project-meta { font-weight: 400; color: var(--muted); font-size: 0.85rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        th, td { text-align: left; padding: 0.55rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
        th { background: var(--surface); font-weight: 600; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
        tr:last-child td { border-bottom: 0; }
        td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all; }
        .tag { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: var(--bg-subtle); padding: 0.1rem 0.4rem; border-radius: 4px; word-break: break-all; }
        .badge {
          display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px;
          font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
        }
        .badge-running { background: var(--badge-running-bg); color: var(--success); }
        .badge-loading { background: var(--badge-loading-bg); color: var(--primary); }
        .badge-not-deployed { background: var(--badge-not-deployed-bg); color: var(--muted); }
        .badge-no-image { background: var(--badge-no-image-bg); color: var(--warn); }
        .badge-error { background: var(--badge-error-bg); color: var(--danger); }
        .badge-other { background: var(--badge-other-bg); color: var(--warn); }
        .stream { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600; background: var(--stream-bg); color: var(--muted); }
        .stream-PRODUCTION { background: var(--stream-prod-bg); color: var(--danger); }
        .stream-STAGING { background: var(--stream-staging-bg); color: var(--warn); }
        .stream-QA { background: var(--stream-qa-bg); color: var(--primary); }
        .empty, .err { padding: 1rem; color: var(--muted); }
        .err { color: var(--danger); background: var(--err-bg); }
        .skeleton { display: inline-block; height: 0.9rem; background: var(--bg-subtle); border-radius: 4px; min-width: 8rem; }
      </style>
      <div class="root">
        <header>
          <h1>Agent Service Images</h1>
          <button class="refresh" id="refresh">Refresh</button>
        </header>
        <div id="projects"></div>
      </div>
    `;

    this.shadowRoot.getElementById('refresh').addEventListener('click', () => {
      for (const p of this.projects) {
        this.projectState[p] = { phase: 'loading', rows: [], error: null };
        this.renderProject(p);
        this.loadProject(p);
      }
    });

    const wrap = this.shadowRoot.getElementById('projects');
    wrap.innerHTML = '';
    for (const p of this.projects) {
      const section = document.createElement('section');
      section.className = 'project';
      section.id = `project-${p}`;
      wrap.appendChild(section);
      this.renderProject(p);
    }
  }

  renderProject(project) {
    const section = this.shadowRoot.getElementById(`project-${project}`);
    if (!section) return;
    const state = this.projectState[project];

    if (state.phase === 'loading') {
      section.innerHTML = `
        <div class="project-header"><span>${this.esc(project)}</span><span class="project-meta">Loading environments…</span></div>
      `;
      return;
    }

    if (state.phase === 'error') {
      section.innerHTML = `
        <div class="project-header"><span>${this.esc(project)}</span></div>
        <div class="err">Failed to load: ${this.esc(state.error || 'unknown error')}</div>
      `;
      return;
    }

    if (!state.rows.length) {
      section.innerHTML = `
        <div class="project-header"><span>${this.esc(project)}</span><span class="project-meta">0 environments</span></div>
        <div class="empty">No environments found in this project.</div>
      `;
      return;
    }

    const rowsHtml = state.rows
      .map((row) => this.rowHtml(project, row))
      .join('');

    section.innerHTML = `
      <div class="project-header">
        <span>${this.esc(project)}</span>
        <span class="project-meta">${state.rows.length} environment${state.rows.length === 1 ? '' : 's'}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 22%">Environment</th>
            <th style="width: 12%">Release Stream</th>
            <th style="width: 12%">Status</th>
            <th>Image Repo</th>
            <th style="width: 24%">Tag</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  renderRow(project, clusterId) {
    const row = this.projectState[project].rows.find((r) => r.clusterId === clusterId);
    if (!row) return;
    const section = this.shadowRoot.getElementById(`project-${project}`);
    if (!section) return;
    const tr = section.querySelector(`tr[data-cid="${CSS.escape(clusterId)}"]`);
    if (!tr) return;
    tr.outerHTML = this.rowHtml(project, row);
  }

  rowHtml(project, row) {
    const status = row.status;
    const badgeCls = {
      loading: 'badge-loading',
      running: 'badge-running',
      'not-deployed': 'badge-not-deployed',
      'no-image': 'badge-no-image',
      error: 'badge-error',
    }[status] || 'badge-other';

    const statusLabel = {
      loading: 'Loading',
      running: 'Running',
      'not-deployed': 'Not deployed',
      'no-image': 'No image',
      error: 'Error',
    }[status] || status;

    const streamCls = `stream stream-${this.esc(row.releaseStream)}`;

    let repoCell;
    let tagCell;
    if (status === 'loading') {
      repoCell = '<span class="skeleton"></span>';
      tagCell = '<span class="skeleton" style="min-width:5rem"></span>';
    } else if (status === 'not-deployed') {
      repoCell = '<span style="color: var(--muted)">—</span>';
      tagCell = '<span style="color: var(--muted)">—</span>';
    } else if (status === 'error') {
      repoCell = `<span style="color: var(--danger)">${this.esc(row.error || 'failed')}</span>`;
      tagCell = '<span style="color: var(--muted)">—</span>';
    } else {
      repoCell = row.repo ? `<span class="mono">${this.esc(row.repo)}</span>` : '<span style="color: var(--muted)">—</span>';
      tagCell = row.tag ? `<span class="tag">${this.esc(row.tag)}</span>` : '<span style="color: var(--muted)">—</span>';
    }

    return `
      <tr data-cid="${this.esc(row.clusterId)}">
        <td>${this.esc(row.envName)}</td>
        <td><span class="${streamCls}">${this.esc(row.releaseStream || '—')}</span></td>
        <td><span class="badge ${badgeCls}">${this.esc(statusLabel)}</span></td>
        <td>${repoCell}</td>
        <td>${tagCell}</td>
      </tr>
    `;
  }

  esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

customElements.define('agent-service-images', AgentServiceImages);
