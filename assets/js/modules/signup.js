import { supabase } from '../supabase-client.js';
import { el, toast } from '../utils.js';

const OTP_LENGTH = 6;

export async function renderSignup(root) {
  root.innerHTML = '';

  const { data: { session } } = await supabase.auth.getSession();
  if (session) { location.hash = '#dashboard'; return; }

  // Load plans for the picker
  let plans = [];
  try {
    const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order');
    plans = data || [];
  } catch {}

  // ---- Container ----
  const wrap = el('div', { class: 'min-h-screen flex flex-col lg:flex-row bg-slate-50' });

  // ---- Left branding ----
  const left = el('div', { class: 'lg:w-2/5 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white p-8 lg:p-12 flex flex-col justify-between' }, [
    el('div', {}, [
      el('div', { class: 'flex items-center gap-3 mb-12' }, [
        el('div', { class: 'w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl' }, '🍽️'),
        el('div', { class: 'font-bold text-lg' }, 'RestoPOS'),
      ]),
      el('div', {}, [
        el('h1', { class: 'text-3xl lg:text-4xl font-bold leading-tight mb-4' }, 'Run your restaurant like a pro'),
        el('p', { class: 'text-white/70 text-base lg:text-lg leading-relaxed' }, 'Point of sale, kitchen display, inventory, loyalty and reports — all in one place. Start free for 14 days.'),
      ]),
    ]),
    el('div', { class: 'space-y-3 mt-8' }, [
      feature('✓', 'Bill in under 10 seconds'),
      feature('✓', 'Live kitchen display (KDS)'),
      feature('✓', 'Offline-first POS'),
      feature('✓', 'GST-ready invoicing'),
      feature('✓', 'No setup fees · Cancel anytime'),
    ]),
  ]);

  // ---- Right: form or OTP depending on step ----
  const right = el('div', { class: 'lg:w-3/5 flex items-center justify-center p-6 lg:p-12' });
  const cardContainer = el('div', { class: 'w-full max-w-lg' });
  right.appendChild(cardContainer);

  wrap.appendChild(left);
  wrap.appendChild(right);
  root.appendChild(wrap);

  // ---- Step 1: Signup form ----
  const formState = {
    name: '', owner: '', email: '', phone: '', city: '',
    password: '', planCode: plans[0]?.code || 'starter',
  };

  function renderForm() {
    cardContainer.innerHTML = '';
    const card = el('div', { class: 'bg-white rounded-2xl shadow-xl border border-slate-200 p-6 lg:p-8' });

    card.appendChild(el('div', { class: 'mb-6' }, [
      el('h2', { class: 'text-2xl font-bold text-slate-800' }, 'Create your account'),
      el('p', { class: 'text-sm text-slate-500 mt-1' }, '14-day free trial · No credit card required'),
    ]));

    const nameIn = el('input', { type: 'text', placeholder: 'e.g. Spice Route Restaurant', class: inputCls, value: formState.name });
    const ownerIn = el('input', { type: 'text', placeholder: 'Your full name', class: inputCls, value: formState.owner });
    const emailIn = el('input', { type: 'email', placeholder: 'you@restaurant.com', autocomplete: 'email', class: inputCls, value: formState.email });
    const phoneIn = el('input', { type: 'tel', placeholder: '+91 98765 43210', class: inputCls, value: formState.phone });
    const cityIn = el('input', { type: 'text', placeholder: 'Mumbai', class: inputCls, value: formState.city });
    const passIn = el('input', { type: 'password', placeholder: 'Password (min 8 chars)', autocomplete: 'new-password', class: inputCls });

    card.appendChild(field('Restaurant name', nameIn));
    card.appendChild(el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
      field('Your name', ownerIn),
      field('Phone', phoneIn),
    ]));
    card.appendChild(el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
      field('Email', emailIn),
      field('City', cityIn),
    ]));
    card.appendChild(field('Password', passIn));

    // Plan picker
    const planBox = el('div', { class: 'mt-4' });
    planBox.appendChild(el('div', { class: 'text-xs font-medium text-slate-600 mb-2' }, 'Choose your plan'));
    const planGrid = el('div', { class: 'grid grid-cols-3 gap-2' });
    const list = plans.length ? plans : [
      { code: 'starter',    name: 'Starter',    price_monthly: 999,  limits: { outlets: 1 } },
      { code: 'growth',     name: 'Growth',     price_monthly: 2499, limits: { outlets: 3 } },
      { code: 'enterprise', name: 'Enterprise', price_monthly: 6999, limits: { outlets: 50 } },
    ];

    function paintPlans() {
      planGrid.innerHTML = '';
      list.forEach(p => {
        const isActive = formState.planCode === p.code;
        planGrid.appendChild(el('button', {
          type: 'button',
          class: `text-left p-2.5 rounded-lg border-2 transition ${isActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`,
          onclick: () => { formState.planCode = p.code; paintPlans(); },
        }, [
          el('div', { class: 'text-xs font-semibold text-slate-700' }, p.name),
          el('div', { class: 'text-[11px] text-slate-500 mt-0.5' }, `₹${p.price_monthly}/mo`),
          el('div', { class: 'text-[10px] text-slate-400 mt-1' }, `${p.limits?.outlets || 1} outlet${(p.limits?.outlets || 1) > 1 ? 's' : ''}`),
        ]));
      });
    }
    paintPlans();
    planBox.appendChild(planGrid);
    card.appendChild(planBox);

    // Consent
    card.appendChild(el('label', { class: 'flex items-start gap-2 mt-4 text-xs text-slate-600 cursor-pointer' }, [
      el('input', { type: 'checkbox', class: 'mt-0.5', checked: true }),
      el('span', {}, 'I agree to the Terms of Service and Privacy Policy.'),
    ]));

    // Submit
    const submitBtn = el('button', {
      class: 'w-full mt-5 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow transition',
    }, 'Send verification code');
    card.appendChild(submitBtn);

    card.appendChild(el('div', { class: 'text-center text-xs text-slate-500 mt-4' }, [
      'Already have an account? ',
      el('a', { href: '#login', class: 'text-indigo-600 hover:text-indigo-800 font-medium' }, 'Sign in'),
    ]));

    cardContainer.appendChild(card);

    // Enter key submits
    [nameIn, ownerIn, emailIn, phoneIn, cityIn, passIn].forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
    });

    submitBtn.addEventListener('click', async () => {
      const name = nameIn.value.trim();
      const email = emailIn.value.trim().toLowerCase();
      const pass = passIn.value;

      if (!name || name.length < 2) { toast('Enter your restaurant name', 'warn'); nameIn.focus(); return; }
      if (!email || !email.includes('@')) { toast('Enter a valid email', 'warn'); emailIn.focus(); return; }
      if (!pass || pass.length < 8) { toast('Password must be at least 8 characters', 'warn'); passIn.focus(); return; }

      // Save state so OTP screen can reuse it
      formState.name = name;
      formState.owner = ownerIn.value.trim();
      formState.email = email;
      formState.phone = phoneIn.value.trim();
      formState.city = cityIn.value.trim();
      formState.password = pass;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending code…';

      try {
        const { data: authData, error: authErr } = await supabase.auth.signUp({
          email,
          password: pass,
          options: {
            data: {
              full_name:       formState.owner || name,
              restaurant_name: name,
              owner_name:      formState.owner || name,
              phone:           formState.phone || null,
              city:            formState.city || null,
              state_code:      '27',
              country:         'IN',
              plan_code:       formState.planCode,
            },
          },
        });

        if (authErr) throw authErr;

        // If Supabase returned a session, email confirmation is disabled —
        // skip OTP and onboard directly.
        if (authData.session) {
          await completeOnboarding();
          return;
        }

        // Otherwise, email confirmation is required — show OTP screen
        toast('We sent a 6-digit code to ' + email, 'info', 4000);
        renderOtpStep();

      } catch (err) {
        console.error('[signup]', err);
        const msg = err?.message || 'Signup failed';
        if (msg.includes('already registered') || msg.includes('already been registered')) {
          toast('That email is already registered. Try signing in.', 'warn', 4000);
        } else {
          toast(msg, 'error', 5000);
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send verification code';
      }
    });

    setTimeout(() => nameIn.focus(), 100);
  }

  // ---- Step 2: OTP entry ----
  function renderOtpStep() {
    cardContainer.innerHTML = '';
    const card = el('div', { class: 'bg-white rounded-2xl shadow-xl border border-slate-200 p-6 lg:p-8' });

    card.appendChild(el('div', { class: 'text-center mb-6' }, [
      el('div', { class: 'w-14 h-14 rounded-2xl bg-indigo-100 mx-auto flex items-center justify-center text-2xl mb-3' }, '📧'),
      el('h2', { class: 'text-2xl font-bold text-slate-800' }, 'Check your inbox'),
      el('p', { class: 'text-sm text-slate-500 mt-2' }, 'We sent a 6-digit code to'),
      el('div', { class: 'text-sm font-semibold text-indigo-700 mt-1 truncate' }, formState.email),
    ]));

    // 6 OTP boxes
    const inputs = [];
    const otpRow = el('div', { class: 'flex justify-center gap-2 my-6' });
    for (let i = 0; i < OTP_LENGTH; i++) {
      const inp = el('input', {
        type: 'text',
        inputmode: 'numeric',
        maxlength: '1',
        class: 'w-12 h-14 text-center text-2xl font-bold rounded-lg border-2 border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-0 transition',
      });
      inputs.push(inp);
      otpRow.appendChild(inp);
    }
    card.appendChild(otpRow);

    // Wire up auto-advance + paste
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '');
        e.target.value = v.slice(0, 1);
        if (v && i < OTP_LENGTH - 1) inputs[i + 1].focus();
        if (getOtp().length === OTP_LENGTH) verifyBtn.click();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
        if (e.key === 'ArrowLeft'  && i > 0) inputs[i - 1].focus();
        if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) inputs[i + 1].focus();
      });
      inp.addEventListener('paste', (e) => {
        const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
        if (!text) return;
        e.preventDefault();
        text.split('').forEach((c, j) => { if (inputs[i + j]) inputs[i + j].value = c; });
        const last = Math.min(i + text.length, OTP_LENGTH - 1);
        inputs[last].focus();
        if (getOtp().length === OTP_LENGTH) verifyBtn.click();
      });
    });

    function getOtp() {
      return inputs.map(i => i.value).join('');
    }

    // Verify button
    const verifyBtn = el('button', {
      class: 'w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow transition',
    }, 'Verify & create account');
    card.appendChild(verifyBtn);

    // Resend row
    const resendBtn = el('button', {
      class: 'w-full mt-3 text-xs text-slate-500 hover:text-indigo-600 transition',
    }, 'Resend code');
    card.appendChild(resendBtn);

    // Back row
    card.appendChild(el('div', { class: 'text-center text-xs text-slate-400 mt-4' }, [
      'Wrong email? ',
      el('button', {
        class: 'text-indigo-600 hover:text-indigo-800 font-medium',
        onclick: () => renderForm(),
      }, 'Go back'),
    ]));

    cardContainer.appendChild(card);
    setTimeout(() => inputs[0].focus(), 100);

    // Verify
    verifyBtn.addEventListener('click', async () => {
      const token = getOtp();
      if (token.length !== OTP_LENGTH) { toast('Enter all 6 digits', 'warn'); return; }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying…';

      try {
        const { data, error } = await supabase.auth.verifyOtp({
          email: formState.email,
          token,
          type: 'signup',
        });
        if (error) throw error;
        if (!data.session) throw new Error('Verification did not return a session');

        toast('Email verified! Setting up your restaurant…', 'success', 2000);

        // Continue to onboarding (creates tenant via RPC)
        await completeOnboarding();

      } catch (err) {
        console.error('[otp]', err);
        const msg = err?.message || 'Verification failed';
        if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('invalid')) {
          toast('Code is invalid or expired. Try again.', 'error', 4000);
        } else {
          toast(msg, 'error', 5000);
        }
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & create account';
        inputs.forEach(i => i.value = '');
        inputs[0].focus();
      }
    });

    // Resend
    let resendCooldown = 0;
    const resendTimer = setInterval(() => {
      if (resendCooldown > 0) {
        resendCooldown--;
        resendBtn.textContent = `Resend code in ${resendCooldown}s`;
        resendBtn.disabled = true;
      } else {
        resendBtn.textContent = 'Resend code';
        resendBtn.disabled = false;
      }
    }, 1000);

    resendBtn.addEventListener('click', async () => {
      if (resendCooldown > 0) return;
      resendBtn.disabled = true;
      try {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: formState.email,
        });
        if (error) throw error;
        toast('New code sent', 'success');
        resendCooldown = 60;
      } catch (err) {
        console.error('[resend]', err);
        toast('Could not resend: ' + (err.message || 'try again later'), 'error');
        resendBtn.disabled = false;
      }
    });
  }

  // ---- After auth: create tenant ----
  async function completeOnboarding() {
    try {
      // Check if user already has a membership (from a prior partial attempt)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user session');

      const { count } = await supabase
        .from('tenant_members')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (!count) {
        const { error: rpcErr } = await supabase.rpc('signup_tenant', {
          p_restaurant_name: formState.name,
          p_owner_name:      formState.owner || null,
          p_phone:           formState.phone || null,
          p_city:            formState.city || null,
          p_state_code:      '27',
          p_country:         'IN',
          p_plan_code:       formState.planCode,
        });
        if (rpcErr) throw rpcErr;
      }

      toast(`Welcome, ${formState.name}! Your 14-day trial has started.`, 'success', 4000);

      setTimeout(() => {
        location.hash = '#dashboard';
        location.reload();
      }, 1000);

    } catch (err) {
      console.error('[onboarding]', err);
      toast('Account verified, but setup failed: ' + (err.message || 'unknown'), 'error', 8000);
      setTimeout(() => { location.hash = '#dashboard'; location.reload(); }, 1500);
    }
  }

  // ---- Initial render ----
  renderForm();
}

// ============================================================
// ONBOARDING MODAL (fallback for stuck accounts)
// ============================================================
export async function showOnboardingModal(root, { onComplete }) {
  root.innerHTML = '';
  let plans = [];
  try {
    const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order');
    plans = data || [];
  } catch {}

  const overlay = el('div', { class: 'fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 z-[100] flex items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8 p-6 md:p-8' });

  card.appendChild(el('div', { class: 'text-center mb-6' }, [
    el('div', { class: 'w-14 h-14 rounded-2xl bg-indigo-100 mx-auto flex items-center justify-center mb-3 text-2xl' }, '🏪'),
    el('h2', { class: 'text-2xl font-bold text-slate-800' }, 'One last step'),
    el('p', { class: 'text-sm text-slate-500 mt-1' }, 'Tell us about your restaurant to get started.'),
  ]));

  const nameIn = el('input', { type: 'text', placeholder: 'e.g. Spice Route Restaurant', class: inputCls });
  const phoneIn = el('input', { type: 'tel', placeholder: '+91 98765 43210', class: inputCls });
  const cityIn = el('input', { type: 'text', placeholder: 'Mumbai', class: inputCls });

  card.appendChild(field('Restaurant name', nameIn));
  card.appendChild(el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
    field('Phone', phoneIn),
    field('City', cityIn),
  ]));

  const chosen = { code: plans[0]?.code || 'starter' };
  const planBox = el('div', { class: 'mt-4' });
  planBox.appendChild(el('div', { class: 'text-xs font-medium text-slate-600 mb-2' }, 'Choose your plan'));
  const planGrid = el('div', { class: 'grid grid-cols-3 gap-2' });

  function paintPlans() {
    planGrid.innerHTML = '';
    const list = plans.length ? plans : [
      { code: 'starter',    name: 'Starter',    price_monthly: 999 },
      { code: 'growth',     name: 'Growth',     price_monthly: 2499 },
      { code: 'enterprise', name: 'Enterprise', price_monthly: 6999 },
    ];
    list.forEach(p => {
      const isActive = chosen.code === p.code;
      planGrid.appendChild(el('button', {
        type: 'button',
        class: `text-left p-2.5 rounded-lg border-2 transition ${isActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`,
        onclick: () => { chosen.code = p.code; paintPlans(); },
      }, [
        el('div', { class: 'text-xs font-semibold text-slate-700' }, p.name),
        el('div', { class: 'text-[11px] text-slate-500 mt-0.5' }, `₹${p.price_monthly}/mo`),
      ]));
    });
  }
  paintPlans();
  planBox.appendChild(planGrid);
  card.appendChild(planBox);

  const submitBtn = el('button', {
    class: 'w-full mt-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow transition',
  }, 'Create my restaurant');
  card.appendChild(submitBtn);

  card.appendChild(el('button', {
    class: 'w-full mt-2 py-2 text-xs text-slate-400 hover:text-slate-700 transition',
    onclick: async () => {
      const { signOut } = await import('../auth.js');
      await signOut();
      location.reload();
    },
  }, 'Sign out'));

  overlay.appendChild(card);
  root.appendChild(overlay);
  setTimeout(() => nameIn.focus(), 100);

  submitBtn.addEventListener('click', async () => {
    const name = nameIn.value.trim();
    if (!name || name.length < 2) { toast('Enter your restaurant name', 'warn'); nameIn.focus(); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Setting up…';

    try {
      await supabase.auth.updateUser({
        data: {
          restaurant_name: name,
          phone:  phoneIn.value.trim() || null,
          city:   cityIn.value.trim() || null,
          state_code: '27',
          country: 'IN',
          plan_code: chosen.code,
        },
      });

      const { data, error } = await supabase.rpc('signup_tenant', {
        p_restaurant_name: name,
        p_owner_name:      null,
        p_phone:           phoneIn.value.trim() || null,
        p_city:            cityIn.value.trim() || null,
        p_state_code:      '27',
        p_country:         'IN',
        p_plan_code:       chosen.code,
      });
      if (error) throw error;

      toast(`Welcome to ${name}!`, 'success', 4000);
      setTimeout(() => { if (onComplete) onComplete(data); else location.reload(); }, 800);
    } catch (err) {
      console.error('[onboarding]', err);
      toast(err?.message || 'Setup failed', 'error', 5000);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create my restaurant';
    }
  });
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', { class: 'mb-4' }, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
function feature(icon, text) {
  return el('div', { class: 'flex items-center gap-2 text-sm text-white/80' }, [
    el('span', { class: 'text-emerald-400 font-bold' }, icon),
    el('span', {}, text),
  ]);
}
