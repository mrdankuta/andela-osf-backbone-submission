<script lang="ts">
  import { page } from '$app/state';
  import { api } from '$convex/_generated/api';
  import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
  import { browser } from '$app/environment';
  import Tabbar from '$lib/Tabbar.svelte';
  const client = useConvexClient();

  function device() {
    if (!browser) return 'server';
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  const deviceId = device();

  const list = useQuery(api.opportunities.list, () => ({}));
  const opps = $derived(list.data ?? []);
  const threads = useQuery(api.backboneAgent.listThreads, () => ({ deviceId }));
  const convos = $derived(threads.data ?? []);

  // Deep link from opportunity detail: /assistant?id=<oppId>
  let sel = $state<string | null>(browser ? page.url.searchParams.get('id') : null);
  let threadId = $state<string | null>(null);
  let lang = $state(browser ? localStorage.getItem('ba-lang') ?? 'English' : 'English');
  let msgs = $state<{ me: boolean; text: string; cite?: string; quote?: { text: string; sourceUrl: string } | null; verified?: boolean; citeNote?: string }[]>([]);
  let input = $state('');
  let offline = $state(false);
  let agentNote = $state('');
  let loading = $state(false);

  const opp = $derived(opps.find((o) => o._id === sel) ?? convos.find((c) => c.opportunityId === sel));

  function greeted(id: string) {
    if (!browser) return false;
    return localStorage.getItem(`ba-greet-${id}`) === '1';
  }
  function markGreeted(id: string) {
    if (browser) localStorage.setItem(`ba-greet-${id}`, '1');
  }

  async function openConvo(id: string) {
    sel = id;
    msgs = [];
    agentNote = '';
    loading = true;
    if (browser) {
      const u = new URL(window.location.href);
      u.searchParams.set('id', id);
      window.history.replaceState({}, '', u);
    }
    try {
      const r = await client.mutation(api.backboneAgent.ensureThreadForOpportunity, { opportunityId: id as never, deviceId });
      threadId = r.threadId;
      const hist = await client.query(api.backboneAgent.listMessages, { threadId });
      msgs = hist.filter((m) => m.text).map((m) => ({ me: false as const, text: m.text }));
    } catch {
      threadId = `local-${deviceId}-${id}`;
      offline = true;
    }
    if (msgs.length === 0 && !greeted(id)) {
      const o = opps.find((x) => x._id === id);
      msgs = [{ me: false, text: o ? `Ask me anything about “${o.title}” — eligibility, documents, steps, or deadline. I answer from its verified details.` : 'Ask me anything about this opportunity.' }];
      markGreeted(id);
    }
    loading = false;
  }

  // Auto-open deep-linked conversation once catalogue loads
  $effect(() => {
    if (sel && opps.length > 0 && threadId === null && !loading && msgs.length === 0) {
      openConvo(sel);
    }
  });

  function setLang(l: string) {
    lang = l;
    if (browser) localStorage.setItem('ba-lang', l);
  }

  async function ask(q: string) {
    if (!q.trim() || !sel) return;
    const question = q.trim();
    msgs.push({ me: true, text: question });
    input = '';
    agentNote = '';
    // 1) Grounded agent reply in this opportunity's own thread
    try {
      const r = await client.mutation(api.backboneAgent.sendOpportunityMessage, {
        opportunityId: sel as never, deviceId, prompt: question, language: lang,
      });
      if (r.blocked) {
        msgs.push({ me: false, text: r.safeReply ?? "I can't help with that." });
        return;
      }
      threadId = r.threadId;
      agentNote = r.agentOk
        ? 'Live answer coming — cited summary meanwhile:'
        : 'Live answer unavailable — cited summary:';
    } catch {
      agentNote = 'Offline — cited summary from saved details:';
      offline = true;
    }
    // 2) Instant cited fallback (works offline, always sourced)
    try {
      let facts: Record<string, unknown> = {};
      try {
        const p = JSON.parse(localStorage.getItem('ba-profile') ?? '{}');
        facts = {
          state: p.state,
          sector: p.sectors?.[0] ?? p.sector,
          businessStage: p.businessStage,
          cac: p.cac,
          staffSize: typeof p.staffSize === 'number' ? p.staffSize : undefined,
          age: p.age,
          womenLed: p.womenLed,
        };
      } catch { facts = {}; }
      const r = await client.query(api.assistant.explain, { id: sel as never, mode: lang === 'English' ? question : lang, ...facts, asOf: Date.now() });
      if (r) msgs.push({ me: false, text: r.text, cite: r.citation, quote: r.quote, verified: r.citationVerified, citeNote: r.citationNote || undefined });
    } catch {
      offline = true;
      msgs.push({ me: false, text: 'Offline — open the opportunity detail for saved steps & documents.', cite: 'Cached' });
    }
  }

  function daysLeft(ts: number) { return Math.ceil((ts - Date.now()) / 86400000); }
</script>
<div class="phone">
  <div class="topbar"><div><strong>Assistant</strong><div class="meta" style="font-size:12px">{sel && opp ? `About: ${(opp as any).title?.slice(0, 34)}…` : 'One chat per opportunity'}</div></div><span class="meta">{offline ? 'Offline' : 'Online'}</span></div>

  {#if !sel}
    <div class="card">
      <p class="section-title">Start or continue a chat</p>
      <p class="meta" style="margin:0 0 10px">Each opportunity gets its own conversation — the assistant only answers from that listing’s verified details.</p>
      {#if threads.isLoading}<p class="meta">Loading conversations…</p>
      {:else if convos.length > 0}
        <div style="border-top:1px solid var(--border);margin-top:4px">
          {#each convos as c}
            <button onclick={() => openConvo(c.opportunityId)} style="display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--border);padding:12px 2px;cursor:pointer;min-height:44px">
              <div style="font-weight:750;line-height:1.35">{c.title}</div>
              <div class="meta">{c.providerName} · {c.amountOrBenefit}{c.deadline ? ` · ${daysLeft(c.deadline)}d left` : ''}</div>
            </button>
          {/each}
        </div>
        <p class="section-title" style="margin-top:14px">Or pick another opportunity</p>
      {/if}
      <select class="input" style="margin-top:12px" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) openConvo(v); }}>
        <option value="">Choose opportunity…</option>
        {#each opps.slice(0, 20) as o}<option value={o._id}>{o.title}</option>{/each}
      </select>
    </div>
  {:else}
    <div class="card" style="padding:12px">
      <div style="display:flex;gap:10px;align-items:center">
        <button class="chip" onclick={() => { sel = null; threadId = null; msgs = []; }} aria-label="Back to conversations">← Chats</button>
        <div style="flex:1;min-width:0">
          <div style="font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{(opp as any)?.title ?? 'Opportunity'}</div>
          <div class="meta"><a href={`/opportunity/${sel}`}>View detail →</a>{#if (opp as any)?.deadline} · {daysLeft((opp as any).deadline)}d left{/if}</div>
        </div>
      </div>
      {#if convos.length > 1}
        <div style="display:flex;gap:8px;margin-top:10px;overflow-x:auto">
          {#each convos.filter((c) => c.opportunityId !== sel).slice(0, 6) as c}
            <button class="chip" style="white-space:nowrap" onclick={() => openConvo(c.opportunityId)}>{c.title.slice(0, 22)}…</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="card">
      <p class="meta" style="margin:0 0 8px">Language / simplify</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        {#each ['English','Plain English','Pidgin','Hausa','Yoruba','Igbo'] as l}
          <button class="chip" aria-pressed={lang===l} onclick={() => setLang(l)}>{l}</button>
        {/each}
      </div>
      <p class="meta" style="margin:8px 0 0">Translations by AI — official English prevails.</p>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        {#each ['Explain simply','Am I eligible?','What docs?','When is the deadline?'] as c}
          <button class="chip" onclick={() => ask(c)}>{c}</button>
        {/each}
      </div>
      {#if agentNote}<p class="meta" style="margin-top:8px">{agentNote}</p>{/if}
    </div>

    <div style="padding:0 14px">
      {#if loading}<p class="meta">Opening conversation…</p>{/if}
      {#each msgs as m}
        <div style={`max-width:86%;padding:10px 12px;border-radius:12px;margin-top:8px;${m.me ? 'margin-left:auto;background:var(--accent);color:#fff' : 'background:#fff;border:1px solid var(--border)'}`}>
          {m.text}
          {#if m.cite}<div class="meta" style="margin-top:6px">[{m.cite}]</div>{/if}
          {#if !m.me && m.verified && m.quote}
            <blockquote class="quote">✓ Quoted from source: “{m.quote.text}” <a href={m.quote.sourceUrl} target="_blank" rel="noreferrer">Open ↗</a></blockquote>
          {:else if !m.me && m.verified === false && m.citeNote}
            <div class="meta" style="margin-top:6px">⚠️ {m.citeNote}</div>
          {/if}
        </div>
      {/each}
    </div>
    <div style="display:flex;gap:8px;padding:12px 14px;position:sticky;bottom:58px;background:var(--bg)">
      <input class="input" placeholder="Ask about this opportunity…" bind:value={input} onkeydown={(e) => e.key==='Enter' && ask(input)} aria-label="Ask about this opportunity" />
      <button class="btn btn-primary" style="width:auto" onclick={() => ask(input)}>Send</button>
    </div>
    <p class="meta" style="padding:0 14px">Grounded in this listing’s verified details — always confirm deadlines on the <a href={`/opportunity/${sel}`}>official link</a>.</p>
  {/if}

  <Tabbar active="assistant" />
</div>
