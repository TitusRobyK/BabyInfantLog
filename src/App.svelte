<script lang="ts">
  import { onMount } from 'svelte'
  import type { RealtimeChannel, Session, User } from '@supabase/supabase-js'
  import AuthScreen from './components/AuthScreen.svelte'
  import EventEditor from './components/EventEditor.svelte'
  import HistoryScreen from './components/HistoryScreen.svelte'
  import InstallNudge from './components/InstallNudge.svelte'
  import LogScreen from './components/LogScreen.svelte'
  import Onboarding from './components/Onboarding.svelte'
  import ResetPassword from './components/ResetPassword.svelte'
  import SettingsScreen from './components/SettingsScreen.svelte'
  import TrendsScreen from './components/TrendsScreen.svelte'
  import { emptyContext, loadContext } from './lib/context'
  import {
    fetchEvents,
    fetchSleepInterruptions,
    fetchSummaries,
    flushPending,
    optimisticEvent,
    restoreEvent,
    saveDiscreteEvent,
    setSessionState,
    setSleepInterruptionState,
    softDeleteEvent,
    updateEvent,
  } from './lib/events'
  import { clearPendingForUser, pendingForUser, removePending } from './lib/offlineQueue'
  import { isConfigured, supabase } from './lib/supabase'
  import type { AppContext, CareEvent, DailySummary, EventDetails, EventType, SleepInterruption } from './lib/types'

  type Route = 'log' | 'history' | 'trends' | 'settings'
  type Toast = { message: string; actionLabel?: string; action?: () => void }

  let session: Session | null = null
  let user: User | null = null
  let context: AppContext = emptyContext
  let events: CareEvent[] = []
  let summaries: DailySummary[] = []
  let sleepInterruptions: SleepInterruption[] = []
  let route: Route = 'log'
  let loading = true
  let error = ''
  let online = navigator.onLine
  let pendingCount = 0
  let busySession = false
  let busyInterruption = false
  let editingEvent: CareEvent | null = null
  let resetPasswordMode = new URLSearchParams(window.location.search).get('reset') === '1'
  let toast: Toast | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let channel: RealtimeChannel | null = null

  onMount(() => {
    void initialize()
    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession
      user = nextSession?.user ?? null
      if (event === 'PASSWORD_RECOVERY') resetPasswordMode = true
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void loadApplication()
    })

    const handleOnline = () => {
      online = true
      void syncPending()
    }
    const handleOffline = () => (online = false)
    const handleFocus = () => {
      if (navigator.onLine) void syncPending()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('focus', handleFocus)

    return () => {
      authListener.subscription.unsubscribe()
      if (channel) void channel.unsubscribe()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('focus', handleFocus)
    }
  })

  async function initialize() {
    if (!isConfigured) {
      loading = false
      return
    }
    const { data } = await supabase.auth.getSession()
    session = data.session
    user = data.session?.user ?? null
    await loadApplication()
  }

  async function loadApplication() {
    loading = true
    error = ''
    if (!user) {
      context = emptyContext
      events = []
      summaries = []
      sleepInterruptions = []
      loading = false
      return
    }

    try {
      context = await loadContext(user)
      pendingCount = (await pendingForUser(user.id)).length
      if (context.household) {
        await loadHouseholdData()
        subscribeToHousehold(context.household.id)
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The app could not load.'
    } finally {
      loading = false
    }
  }

  async function loadHouseholdData() {
    if (!context.household) return
    const [nextEvents, nextSummaries, nextInterruptions] = await Promise.all([
      fetchEvents(context.household.id),
      fetchSummaries(context.household.id),
      fetchSleepInterruptions(context.household.id),
    ])
    events = nextEvents
    summaries = nextSummaries as DailySummary[]
    sleepInterruptions = nextInterruptions
  }

  function subscribeToHousehold(householdId: string) {
    if (channel) void channel.unsubscribe()
    channel = supabase
      .channel(`household:${householdId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `household_id=eq.${householdId}` },
        () => void loadHouseholdData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_summaries', filter: `household_id=eq.${householdId}` },
        () => void loadHouseholdData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sleep_interruptions', filter: `household_id=eq.${householdId}` },
        () => void loadHouseholdData(),
      )
      .subscribe()
  }

  function scope() {
    if (!user || !context.household || !context.child) throw new Error('Family setup is incomplete.')
    return { userId: user.id, householdId: context.household.id, childId: context.child.id }
  }

  async function logEvent(type: EventType) {
    if (type === 'sleep' || type === 'pump') return
    const occurredAt = new Date().toISOString()
    const optimistic = optimisticEvent(scope(), type, occurredAt)
    events = [optimistic, ...events]
    showToast(`${label(type)} logged`, 'Undo', () => void undoLoggedEvent(optimistic))

    try {
      const saved = await saveDiscreteEvent(optimistic)
      events = events.map((event) => (event.id === saved.id ? saved : event))
      pendingCount = user ? (await pendingForUser(user.id)).length : 0
      if (type === 'feed' && saved.sync_status === 'saved') editingEvent = saved
    } catch {
      events = events.map((event) => (event.id === optimistic.id ? { ...event, sync_status: 'error' } : event))
      showToast(`${label(type)} needs attention`)
    }
  }

  async function changeSession(type: 'sleep' | 'pump', desiredState: 'start' | 'end') {
    const occurredAt = new Date().toISOString()
    const eventId = crypto.randomUUID()
    const appScope = scope()
    busySession = true

    if (desiredState === 'start') {
      events = [optimisticEvent(appScope, type, occurredAt, eventId), ...events]
      showToast(`${label(type)} started`)
    } else {
      events = events.map((event) =>
        event.event_type === type &&
        !event.ended_at &&
        (type === 'sleep' || event.subject_parent_id === user?.id)
          ? { ...event, ended_at: occurredAt, sync_status: online ? 'syncing' : 'offline' }
          : event,
      )
      if (type === 'sleep') {
        sleepInterruptions = sleepInterruptions.map((interruption) =>
          !interruption.ended_at
            ? { ...interruption, ended_at: occurredAt, ended_by: user?.id ?? null, sync_status: online ? 'syncing' : 'offline' }
            : interruption,
        )
      }
    }

    try {
      const result = await setSessionState(appScope, type, desiredState, occurredAt, eventId)
      pendingCount = user ? (await pendingForUser(user.id)).length : 0
      if (online) await loadHouseholdData()
      if (desiredState === 'end') {
        const completed = result.event ?? events.find((event) => event.event_type === type && Boolean(event.ended_at))
        if (type === 'pump' && completed && completed.sync_status !== 'offline') {
          toast = null
          editingEvent = completed
        } else {
          showToast(`${label(type)} saved`, completed ? 'Details' : undefined, completed ? () => (editingEvent = completed) : undefined)
        }
      } else if (result.action === 'existing') {
        showToast(`${label(type)} was already active`)
      }
    } catch {
      showToast(`${label(type)} needs attention`)
      if (online) await loadHouseholdData()
    } finally {
      busySession = false
    }
  }

  async function changeSleepInterruption(desiredState: 'start' | 'end') {
    const activeSleep = events.find((event) => event.event_type === 'sleep' && !event.ended_at && !event.deleted_at)
    if (!activeSleep) {
      showToast('Start sleep before adding an interruption')
      return
    }

    const occurredAt = new Date().toISOString()
    const interruptionId = crypto.randomUUID()
    const appScope = scope()
    busyInterruption = true

    if (desiredState === 'start') {
      sleepInterruptions = [{
        id: interruptionId,
        household_id: appScope.householdId,
        child_id: appScope.childId,
        sleep_event_id: activeSleep.id,
        started_at: occurredAt,
        ended_at: null,
        created_by: appScope.userId,
        ended_by: null,
        recorded_at: occurredAt,
        updated_at: occurredAt,
        deleted_at: null,
        sync_status: online ? 'syncing' : 'offline',
      }, ...sleepInterruptions]
      showToast('Sleep interruption started')
    } else {
      sleepInterruptions = sleepInterruptions.map((interruption) =>
        interruption.sleep_event_id === activeSleep.id && !interruption.ended_at
          ? { ...interruption, ended_at: occurredAt, ended_by: appScope.userId, sync_status: online ? 'syncing' : 'offline' }
          : interruption,
      )
    }

    try {
      const result = await setSleepInterruptionState(appScope, desiredState, occurredAt, interruptionId)
      pendingCount = user ? (await pendingForUser(user.id)).length : 0
      if (online) await loadHouseholdData()
      if (desiredState === 'end') showToast('Sleep resumed')
      else if (result.action === 'existing') showToast('An interruption was already active')
    } catch {
      showToast('Sleep interruption needs attention')
      if (online) await loadHouseholdData()
    } finally {
      busyInterruption = false
    }
  }

  async function undoLoggedEvent(event: CareEvent) {
    if (event.sync_status === 'offline') await removePending(event.id)
    else await softDeleteEvent(event.id)
    events = events.filter((item) => item.id !== event.id)
    pendingCount = user ? (await pendingForUser(user.id)).length : 0
    showToast('Event removed')
  }

  async function saveEditedEvent(event: CareEvent, occurredAt: string, details: EventDetails, endedAt?: string | null) {
    await updateEvent(event.id, {
      occurred_at: occurredAt,
      details,
      ...(event.event_type === 'pump' ? { ended_at: endedAt ?? null } : {}),
    })
    await loadHouseholdData()
    showToast('Event updated')
  }

  async function removeEditedEvent(event: CareEvent) {
    await softDeleteEvent(event.id)
    events = events.filter((item) => item.id !== event.id)
    showToast('Event removed', 'Restore', () => void restoreRemovedEvent(event.id))
  }

  async function restoreRemovedEvent(id: string) {
    await restoreEvent(id)
    await loadHouseholdData()
    showToast('Event restored')
  }

  async function syncPending() {
    if (!user || !context.household) return
    const result = await flushPending(user.id)
    pendingCount = (await pendingForUser(user.id)).length
    if (result.completed) {
      await loadHouseholdData()
      showToast(`${result.completed} ${result.completed === 1 ? 'event' : 'events'} synced`)
    }
  }

  async function signOut() {
    if (!user) return
    if (pendingCount && !window.confirm(`${pendingCount} event(s) have not synced. Log out and remove them from this device?`)) return
    if (pendingCount) await clearPendingForUser(user.id)
    await supabase.auth.signOut()
    route = 'log'
  }

  function showToast(message: string, actionLabel?: string, action?: () => void) {
    toast = { message, actionLabel, action }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = null), 5_000)
  }

  function runToastAction() {
    const action = toast?.action
    toast = null
    action?.()
  }

  function label(type: EventType) {
    return type === 'diaper_check' ? 'Diaper check' : type.charAt(0).toUpperCase() + type.slice(1)
  }

  function finishReset() {
    resetPasswordMode = false
    history.replaceState({}, '', '/')
    showToast('Password updated')
  }
</script>

{#if !isConfigured}
  <main class="auth-shell"><section class="auth-panel"><h1>Setup required</h1><p>Copy <code>.env.example</code> to <code>.env</code> and add the Supabase project URL and publishable key.</p></section></main>
{:else if loading}
  <main class="loading-screen" aria-live="polite">Loading…</main>
{:else if resetPasswordMode && session}
  <ResetPassword onDone={finishReset} />
{:else if !session || !user}
  <AuthScreen />
{:else if !context.membership || !context.household || !context.child || !context.profile}
  <Onboarding {user} profile={context.profile} onComplete={loadApplication} />
{:else}
  <div class="app-shell">
    <button
      class="settings-link"
      type="button"
      aria-label={route === 'settings' ? 'Back to Baby Log' : 'Open settings'}
      on:click={() => (route = route === 'settings' ? 'log' : 'settings')}
    >
      {route === 'settings' ? 'Back to log' : 'Settings'}
    </button>

    {#if error}<p class="global-error" role="alert">{error}</p>{/if}
    {#if route === 'log'}
      <LogScreen
        child={context.child}
        timezone={context.household.timezone}
        profile={context.profile}
        members={context.members}
        {events}
        interruptions={sleepInterruptions}
        {online}
        {busySession}
        {busyInterruption}
        onLog={logEvent}
        onSession={changeSession}
        onInterruption={changeSleepInterruption}
        onEdit={(event) => (editingEvent = event)}
      />
    {:else if route === 'history'}
      <HistoryScreen {events} interruptions={sleepInterruptions} timezone={context.household.timezone} profile={context.profile} members={context.members} onEdit={(event) => (editingEvent = event)} />
    {:else if route === 'trends'}
      <TrendsScreen {events} interruptions={sleepInterruptions} {summaries} timezone={context.household.timezone} />
    {:else}
      <SettingsScreen {context} {pendingCount} onUpdated={loadApplication} onSignOut={signOut} />
    {/if}

    <nav class="bottom-nav" aria-label="Primary">
      <button class:active={route === 'log'} type="button" on:click={() => (route = 'log')}>Log</button>
      <button class:active={route === 'history'} type="button" on:click={() => (route = 'history')}>History</button>
      <button class:active={route === 'trends'} type="button" on:click={() => (route = 'trends')}>Trends</button>
    </nav>

  </div>
{/if}

{#if isConfigured && !loading && !resetPasswordMode}
  <InstallNudge />
{/if}

{#if editingEvent && context.profile}
  <EventEditor
    event={editingEvent}
    defaultUnit={context.profile.volume_unit}
    onClose={() => (editingEvent = null)}
    onSave={saveEditedEvent}
    onRemove={removeEditedEvent}
  />
{/if}

{#if toast}
  <div class="toast" role="status">
    <span>{toast.message}</span>
    {#if toast.actionLabel}<button type="button" on:click={runToastAction}>{toast.actionLabel}</button>{/if}
  </div>
{/if}
