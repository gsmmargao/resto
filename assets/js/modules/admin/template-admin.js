import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, toast } from '../../utils.js';
import { DEFAULT_TEMPLATE, TEMPLATE_VARIABLES, renderTemplate } from '../whatsapp.js';

const state = {
  templates: [],
  editing: null,
  loaded: false,
};

const EVENTS = [
  { key: 'receipt',       label: 'Receipt (after payment)' },
  { key: 'order_confirm', label: 'Order confirmation' },
  { key: 'kot_ready',     label: 'Order ready' },
  { key: 'birthday',      label: 'Birthday wish' },
  { key: 'winback',       label: 'Win-back (at-risk customer)' },
  { key: 'feedback',      label: 'Feedback request' },
];

export async function renderTemplateAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading templates…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[template-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const { data } = await supabase.from('message_templates')
    .select('*')
    .eq('tenant_id', store.state.tenant.id)
    .eq('channel', 'whatsapp')
    .order('name');
  state.templates = data || [];
  state.loaded = true;
}

async function refresh() { state.loaded = false; await loadAll(); }

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Message Templates'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.templates.length} template${state.templates.length !== 1 ? 's' : ''} · WhatsApp channel`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openEditor(root, null),
      }, '+ New Template'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-6xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  if (!state.templates.length) {
    inner.appendChild(el('div', { class: 'bg-white rounded-xl border border-slate-200 p-10 text-center' }, [
      el('div', { class: 'text-5xl mb-3 opacity-40' }, '💬'),
      el('h3', { class: 'text-lg font-semibold text-slate-700' }, 'No templates yet'),
      el('p', { class: 'text-sm text-slate-500 mt-1 mb-4' }, 'Create your first WhatsApp template to customise receipt messages.'),
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold',
        onclick: () => openEditor(root, null, 'receipt'),
      }, 'Create Receipt Template'),
    ]));
    return;
  }

  inner.appendChild(buildTemplateGrid(root));
}

function buildTemplateGrid(root) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Templates (${state.templates.length})`),
  ]));

  const grid = el('div', { class: 'p-4 grid grid-cols-1 md:grid-cols-2 gap-3' });
  state.templates.forEach(t => grid.appendChild(buildTemplateCard(t, root)));
  card.appendChild(grid);
  return card;
}

function buildTemplateCard(t, root) {
  const eventInfo = EVENTS.find(e => e.key === t.event_key) || { label: t.event_key || '—' };

  return el('div', { class: `bg-white rounded-xl border ${t.is_active ? 'border-slate-200' : 'border-dashed border-red-300 opacity-70'} overflow-hidden` }, [
    el('div', { class: 'p-4 space-y-3' }, [
      el('div', { class: 'flex items-start justify-between gap-2' }, [
        el('div', { class: 'min-w-0' }, [
          el('div', { class: 'font-semibold text-slate-800 text-sm truncate' }, t.name),
          el('div', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold inline-block mt-1' },
            eventInfo.label),
        ]),
        t.is_active
          ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold shrink-0' }, 'ACTIVE')
          : el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold shrink-0' }, 'INACTIVE'),
      ]),
      el('pre', { class: 'text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap break-words font-mono max-h-32 overflow-y-auto' },
        t.body?.slice(0, 400) + (t.body?.length > 400 ? '…' : '')),
    ]),
    el('div', { class: 'px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between' }, [
      el('span', { class: 'text-[10px] text-slate-400' }, new Date(t.updated_at || t.created_at).toLocaleDateString('en-IN')),
      el('div', { class: 'flex items-center gap-1' }, [
        el('button', {
          class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
          onclick: () => openEditor(root, t),
        }, 'Edit'),
        el('button', {
          class: `text-[10px] px-2 py-1 rounded ${t.is_active ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'}`,
          onclick: async () => {
            const { error } = await supabase.from('message_templates')
              .update({ is_active: !t.is_active }).eq('id', t.id);
            if (error) { toast('Failed: ' + error.message, 'error'); return; }
            t.is_active = !t.is_active;
            toast(t.is_active ? 'Activated' : 'Deactivated', 'success', 1200);
            paint(root);
          },
        }, t.is_active ? 'Disable' : 'Enable'),
        el('button', {
          class: 'text-[10px] px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600',
          onclick: async () => {
            if (!confirm(`Delete template "${t.name}"?`)) return;
            const { error } = await supabase.from('message_templates').delete().eq('id', t.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            toast('Deleted', 'success');
            await refresh();
            paint(root);
          },
        }, 'Delete'),
      ]),
    ]),
  ]);
}

// ============================================================
// EDITOR
// ============================================================
function openEditor(root, template, defaultEvent = null) {
  const isNew = !template;
  const tenantId = store.state.tenant.id;

  const draft = template ? { ...template } : {
    tenant_id: tenantId,
    name: 'Receipt',
    channel: 'whatsapp',
    event_key: defaultEvent || 'receipt',
    language: 'en',
    body: DEFAULT_TEMPLATE,
    is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8 flex flex-col max-h-[92vh]' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Template' : 'Edit Template'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 overflow-hidden' });

  // LEFT: Form + body
  const left = el('div', { class: 'md:col-span-2 p-5 space-y-4 overflow-y-auto border-r border-slate-200' });

  left.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Template name *', el('input', {
      type: 'text', value: draft.name, class: inputCls,
      oninput: e => { draft.name = e.target.value; },
    })),
    field('Event', el('select', {
      class: inputCls,
      onchange: e => { draft.event_key = e.target.value; },
    }, EVENTS.map(ev =>
      el('option', { value: ev.key, selected: draft.event_key === ev.key ? true : null }, ev.label)))),
  ]));

  left.appendChild(field('Language', el('select', {
    class: inputCls,
    onchange: e => { draft.language = e.target.value; },
  }, ['en', 'hi', 'mr', 'ta', 'te'].map(l =>
    el('option', { value: l, selected: draft.language === l ? true : null }, l)))));

  const bodyArea = el('textarea', {
    rows: '14',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none',
    oninput: e => { draft.body = e.target.value; refreshPreview(); },
  }, draft.body);
  left.appendChild(field('Message body', bodyArea));

  body.appendChild(left);

  // RIGHT: variables + preview
  const right = el('div', { class: 'p-5 space-y-3 overflow-y-auto bg-slate-50' });

  right.appendChild(el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide' }, 'Available Variables'));
  const varsBox = el('div', { class: 'space-y-1' });
  TEMPLATE_VARIABLES.forEach(v => {
    varsBox.appendChild(el('button', {
      class: 'w-full text-left px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-slate-200 transition text-xs',
      onclick: () => {
        const ta = bodyArea;
        const start = ta.selectionStart;
        const insert = `{{${v.key}}}`;
        draft.body = ta.value.slice(0, start) + insert + ta.value.slice(ta.selectionEnd);
        ta.value = draft.body;
        ta.focus();
        ta.setSelectionRange(start + insert.length, start + insert.length);
        refreshPreview();
      },
    }, [
      el('div', { class: 'font-mono text-indigo-600 font-semibold' }, `{{${v.key}}}`),
      el('div', { class: 'text-[10px] text-slate-500 mt-0.5' }, v.desc),
    ]));
  });
  right.appendChild(varsBox);

  right.appendChild(el('div', { class: 'pt-3 border-t border-slate-200' }, [
    el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2' }, 'Preview'),
    el('pre', {
      id: 'tpl-preview',
      class: 'text-[11px] text-slate-700 bg-white rounded-lg border border-slate-200 p-3 whitespace-pre-wrap break-words font-sans max-h-72 overflow-y-auto',
    }),
  ]));

  body.appendChild(right);
  card.appendChild(body);

  // Footer
  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl shrink-0' }, [
    el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      id: 'btn-save-template',
      class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
    }, isNew ? 'Create' : 'Save'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function refreshPreview() {
    const preview = document.getElementById('tpl-preview');
    if (!preview) return;
    const sampleVars = {
      customer_name:  'Anjali',
      restaurant:     store.state.tenant?.name || 'Demo Restaurant',
      outlet:         store.state.outlet?.name || 'Main Branch',
      invoice_number: 'INV-00042',
      order_number:   '0042',
      order_date:     new Date().toLocaleString('en-IN'),
      items_list:     '• 2 × Butter Naan — ₹120.00\n• 1 × Paneer Butter Masala (Full) — ₹340.00\n• 1 × Masala Chai (Regular) — ₹60.00',
      subtotal:       '₹520.00',
      discount:       '—',
      tax:            '₹26.00',
      total:          '₹546.00',
      payment_mode:   'UPI',
      table_name:     'T1',
      thank_you:      'Thank you for dining with us!',
    };
    preview.textContent = renderTemplate(draft.body || '', sampleVars);
  }
  refreshPreview();

  footer.querySelector('#btn-save-template').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
    if (!draft.body || !draft.body.trim()) { toast('Body is required', 'warn'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        tenant_id: draft.tenant_id,
        name: draft.name.trim(),
        channel: 'whatsapp',
        event_key: draft.event_key,
        language: draft.language,
        body: draft.body,
        is_active: draft.is_active !== false,
      };
      if (isNew) {
        const { error } = await supabase.from('message_templates').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('message_templates').update(payload).eq('id', template.id);
        if (error) throw error;
      }
      toast(isNew ? 'Template created' : 'Template saved', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = isNew ? 'Create' : 'Save';
    }
  });
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
