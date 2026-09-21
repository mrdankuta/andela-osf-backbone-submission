<script lang="ts">
  import { useConvexClient } from '@mmailaender/convex-svelte';
  import { api } from '$convex/_generated/api';
  import {
    interpretProfileDescription,
    type ProfileField,
    type ProfileInterpretation,
  } from '$lib/profile-interpreter';
  let step = $state(1);
  let firstName = $state('');
  let region = $state('');
  let sectors = $state<string[]>([]);
  let cac = $state('');
  let businessStage = $state('');
  let staffSize = $state<number | undefined>(undefined);
  let age = $state('');
  let womenLed = $state<boolean | undefined>(undefined);
  let needs = $state<string[]>([]);
  let done = $state(false);
  const client = useConvexClient();

  const NEED_FIELDS = ['grant', 'loan', 'accelerator', 'fellowship', 'gov-program'] as const;
  const FIELD_LABELS: Record<ProfileField, string> = {
    state: 'State', sector: 'Sector', businessStage: 'Business stage', cac: 'CAC status',
    staffSize: 'Staff size', age: 'Owner age', womenLed: 'Women-led business',
    grant: 'Grant', loan: 'Loan', accelerator: 'Accelerator', fellowship: 'Fellowship',
    'gov-program': 'Government programme',
  };
  const FIELD_SELECT: Partial<Record<ProfileField, string[]>> = {
    state: ['Lagos', 'Abuja FCT', 'Kano', 'Rivers', 'Oyo', 'Kaduna', 'Abia', 'Ogun', 'Kwara', 'Gombe', 'Other'],
    sector: ['Fashion', 'Food', 'Tech', 'Beauty', 'Agro', 'Other'],
    businessStage: ['Starting', 'Growing', 'Scaling'],
    cac: ['Registered', 'In Progress', 'Not yet'],
    age: ['18–24', '25–35', '35+'],
    womenLed: ['Yes', 'No'],
    grant: ['Yes', 'No'], loan: ['Yes', 'No'], accelerator: ['Yes', 'No'],
    fellowship: ['Yes', 'No'], 'gov-program': ['Yes', 'No'],
  };

  let description = $state('');
  let interpreting = $state(false);
  let interpError = $state('');
  let interp = $state<ProfileInterpretation | null>(null);
  let review = $state<Record<ProfileField, string> | null>(null);
  let appliedMsg = $state('');

  async function interpret() {
    interpError = ''; appliedMsg = '';
    const text = description.trim();
    if (text.length < 10 || text.length > 600) {
      interpError = 'Please describe your business in 10–600 characters.';
      return;
    }
    interpreting = true;
    try {
      let result: ProfileInterpretation;
      try {
        result = await client.action(api.profileInterpretation.interpret, { description: text });
      } catch {
        result = await interpretProfileDescription(text);
      }
      interp = result;
      review = Object.fromEntries(result.proposals.map((p) => [p.field, p.value])) as Record<ProfileField, string>;
    } catch (e) {
      interpError = e instanceof Error ? e.message : 'Could not interpret that description.';
    } finally {
      interpreting = false;
    }
  }

  function applySuggestions() {
    if (!review) return;
    region = review.state === 'unknown' ? '' : review.state;
    sectors = review.sector === 'unknown' ? [] : [review.sector];
    cac = review.cac === 'unknown' ? '' : review.cac;
    businessStage = review.businessStage === 'unknown' ? '' : review.businessStage;
    const n = Number.parseInt(review.staffSize, 10);
    staffSize = review.staffSize === 'unknown' || Number.isNaN(n) ? undefined : n;
    age = review.age === 'unknown' ? '' : review.age;
    womenLed = review.womenLed === 'unknown' ? undefined : review.womenLed === 'Yes';
    needs = NEED_FIELDS.filter((f) => review![f] === 'Yes');
    appliedMsg = 'Suggestions applied. Continue reviewing your profile before saving.';
  }

  function toggle(arr: string[], v: string) {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }
  function owner() {
    let d = localStorage.getItem('ba-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('ba-device', d); }
    return d;
  }
  async function save() {
    localStorage.setItem('ba-profile', JSON.stringify({
      firstName: firstName || undefined, state: region || undefined,
      sectors: sectors.length ? sectors : undefined, cac: cac || undefined,
      businessStage: businessStage || undefined, staffSize,
      age: age || undefined, womenLed, needs: needs.length ? needs : undefined,
    }));
    const clearFields: Array<
      'firstName' | 'state' | 'sector' | 'businessStage' | 'cac' | 'staffSize' | 'age' | 'womenLed' | 'needs'
    > = [];
    if (!firstName) clearFields.push('firstName');
    if (!region) clearFields.push('state');
    if (!sectors.length) clearFields.push('sector');
    if (!cac) clearFields.push('cac');
    if (!businessStage) clearFields.push('businessStage');
    if (staffSize === undefined) clearFields.push('staffSize');
    if (!age) clearFields.push('age');
    if (womenLed === undefined) clearFields.push('womenLed');
    if (!needs.length) clearFields.push('needs');
    try {
      await client.mutation(api.profiles.save, {
        ownerKey: owner(), firstName: firstName || undefined, state: region || undefined,
        sector: sectors[0], businessStage: businessStage || undefined, cac: cac || undefined,
        staffSize, age: age || undefined, womenLed,
        needs: needs.length ? needs.map((n) => n.toLowerCase()) : undefined,
        clearFields,
        source: 'onboarding',
      });
    } catch { /* offline: localStorage is source of truth */ }
    done = true;
  }
</script>
<div class="phone">
  <div class="topbar"><a href="/">←</a><strong>Profile · Step {step} of 3</strong><a href="/home">Skip</a></div>
  <div style="height:8px;background:#e8ece8;border-radius:99px;margin:10px 14px 0"><div style={`width:${step * 33}%;height:100%;background:var(--accent);border-radius:99px`}></div></div>
  {#if !done}
    {#if step === 1}
      <div class="card">
        <strong>Describe your business</strong>
        <p class="meta" style="margin:4px 0 8px">We will suggest profile answers for you to review — nothing is saved until you finish.</p>
        <textarea class="input" rows="4" maxlength="600" bind:value={description} aria-label="Business description" placeholder="Describe what your business does, where it operates, registration, team, and what support you need."></textarea>
        <button class="btn btn-primary" style="margin-top:8px" disabled={interpreting} onclick={interpret}>{interpreting ? 'Reading…' : 'Interpret my description'}</button>
        {#if interpError}<p class="meta" style="margin-top:8px;color:var(--danger)">{interpError}</p>{/if}
      </div>
      {#if interp && review}
        <div class="card">
          <strong>{interp.source === 'typesafe' ? 'AI suggestions — review every answer before using them.' : 'Offline-safe suggestions — review every answer before using them.'}</strong>
          {#each interp.proposals as p (p.field)}
            <div style="margin-top:10px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span class="meta" style="font-weight:700">{FIELD_LABELS[p.field]}</span>
                <span class="meta">{Math.round(p.confidence * 100)}% sure</span>
              </div>
              {#if p.field === 'staffSize'}
                <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
                  <input type="number" class="input" style="flex:1" min="0" max="500" placeholder="Not stated" aria-label="Staff size suggestion"
                    value={review[p.field] === 'unknown' ? '' : review[p.field]}
                    oninput={(e) => { if (review) review[p.field] = e.currentTarget.value === '' ? 'unknown' : e.currentTarget.value; }} />
                  <button class="chip" aria-pressed={review[p.field] === 'unknown'} onclick={() => { if (review) review[p.field] = 'unknown'; }}>Not stated</button>
                </div>
              {:else}
                <select class="input" style="margin-top:4px" bind:value={review[p.field]} aria-label={FIELD_LABELS[p.field]}>
                  <option value="unknown">Not stated</option>
                  {#each FIELD_SELECT[p.field] ?? [] as opt}<option value={opt}>{opt}</option>{/each}
                </select>
              {/if}
            </div>
          {/each}
          <button class="btn btn-primary" style="margin-top:12px" onclick={applySuggestions}>Confirm and use these facts</button>
          {#if appliedMsg}<p class="meta" style="margin-top:8px;color:var(--success);font-weight:700">{appliedMsg}</p>{/if}
        </div>
      {/if}
      <div class="card"><label class="meta">First name<input class="input" placeholder="Adaeze" bind:value={firstName} aria-label="First name" /></label>
      <label class="meta" style="margin-top:8px">State</label><select class="input" bind:value={region} aria-label="State"><option value="">Not sure / not stated</option>{#each ['Lagos','Abuja FCT','Kano','Rivers','Oyo','Kaduna','Abia','Ogun','Kwara','Gombe','Other'] as s}<option>{s}</option>{/each}</select>
      <p class="meta" style="margin-top:10px">Sector</p>
      {#each ['Fashion','Food','Tech','Beauty','Agro','Other'] as s}<button class="chip" aria-pressed={sectors.includes(s)} onclick={() => sectors = toggle(sectors, s)}>{s}</button>{/each}</div>
    {:else if step === 2}
      <div class="card"><p class="meta">CAC status</p>
        {#each ['Registered','In Progress','Not yet','Not sure / not stated'] as c}<button class="chip" aria-pressed={c === 'Not sure / not stated' ? cac === '' : cac===c} onclick={() => cac = c === 'Not sure / not stated' ? '' : c}>{c}</button>{/each}
        <p class="meta" style="margin-top:10px">Business stage</p>
        {#each ['Starting','Growing','Scaling','Not sure / not stated'] as b}<button class="chip" aria-pressed={b === 'Not sure / not stated' ? businessStage === '' : businessStage===b} onclick={() => businessStage = b === 'Not sure / not stated' ? '' : b}>{b}</button>{/each}
        <label class="meta" style="margin-top:8px;display:block">Staff size<input type="number" class="input" min="0" max="500" placeholder="Not stated" aria-label="Staff size" value={staffSize ?? ''} oninput={(e) => { const v = e.currentTarget.value; staffSize = v === '' ? undefined : Number.parseInt(v, 10); }} /></label>
        <p class="meta" style="margin-top:10px">Age</p>
        {#each ['18–24','25–35','35+','Not sure / not stated'] as a}<button class="chip" aria-pressed={a === 'Not sure / not stated' ? age === '' : age===a} onclick={() => age = a === 'Not sure / not stated' ? '' : a}>{a}</button>{/each}
        <p class="meta" style="margin-top:10px">Women-led business</p>
        {#each ['Yes','No','Not sure'] as w}<button class="chip" aria-pressed={w === 'Yes' ? womenLed === true : w === 'No' ? womenLed === false : womenLed === undefined} onclick={() => womenLed = w === 'Yes' ? true : w === 'No' ? false : undefined}>{w}</button>{/each}
      </div>
    {:else}
      <div class="card"><p class="meta">What do you need?</p>
        {#each ['grant','loan','accelerator','fellowship','gov-program'] as n}<button class="chip" aria-pressed={needs.includes(n)} onclick={() => needs = toggle(needs, n)}>{n}</button>{/each}
      </div>
    {/if}
    <div style="padding:0 14px;display:flex;gap:10px">
      {#if step > 1}<button class="btn btn-outline" onclick={() => step--}>Back</button>{/if}
      {#if step < 3}<button class="btn btn-primary" onclick={() => step++}>Continue</button>
      {:else}<button class="btn btn-primary" onclick={save}>See my matches</button>{/if}
    </div>
  {:else}
    <div class="card" style="text-align:center;padding:28px 18px"><div style="font-size:40px">🎉</div><h2>Found matches{firstName ? ` for ${firstName}` : ''} 🎉</h2><p class="meta">Strong profile matches first, deadlines soonest.</p><a class="btn btn-primary" style="text-decoration:none" href="/home">See Discover →</a></div>
  {/if}
</div>
