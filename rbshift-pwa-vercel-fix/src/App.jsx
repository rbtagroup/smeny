import { useEffect, useMemo, useState } from 'react'
import {
  AVAILABILITY_LABEL,
  RESPONSE_LABEL,
  ROLE_LABEL,
  SHIFT_TYPE_LABEL,
  STATUS_LABEL,
  addDays,
  cx,
  driverStats,
  endOfDay,
  formatDate,
  formatDateTime,
  formatTime,
  generateId,
  getProblems,
  isBetween,
  overlaps,
  startOfDay,
  toInputValue,
} from './utils'
import { demoUsers, emptyState } from './demoData'
import { hasSupabaseConfig, supabase } from './supabaseClient'

const STORAGE_KEY = 'rbshift-demo-state-v1'
const DEMO_USER_KEY = 'rbshift-demo-user-v1'

const DEFAULT_SHIFT_FORM = () => {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(6)
  const end = new Date(start)
  end.setHours(14)

  return {
    id: null,
    driver_id: '',
    vehicle_id: '',
    start_at: toInputValue(start),
    end_at: toInputValue(end),
    shift_type: 'R',
    status: 'planned',
    driver_response: 'pending',
    note: '',
  }
}

const DEFAULT_AVAILABILITY_FORM = () => {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setHours(23, 59, 0, 0)
  return {
    id: null,
    driver_id: '',
    from_date: toInputValue(from),
    to_date: toInputValue(to),
    availability_type: 'vacation',
    note: '',
  }
}

const DEFAULT_VEHICLE_FORM = {
  id: null,
  name: '',
  plate: '',
  status: 'active',
  service_from: '',
  service_to: '',
  note: '',
}

const DEFAULT_DRIVER_FORM = {
  id: null,
  profile_id: '',
  display_name: '',
  note: '',
  preferred_shift_types: [],
  active: true,
}

function loadDemoState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState
    const parsed = JSON.parse(raw)
    return {
      ...emptyState,
      ...parsed,
    }
  } catch {
    return emptyState
  }
}

function persistDemoState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function App() {
  const [demoState, setDemoState] = useState(() => loadDemoState())
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [calendarView, setCalendarView] = useState('week')
  const [shiftForm, setShiftForm] = useState(DEFAULT_SHIFT_FORM())
  const [availabilityForm, setAvailabilityForm] = useState(DEFAULT_AVAILABILITY_FORM())
  const [vehicleForm, setVehicleForm] = useState(DEFAULT_VEHICLE_FORM)
  const [driverForm, setDriverForm] = useState(DEFAULT_DRIVER_FORM)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [filters, setFilters] = useState({
    driverId: '',
    vehicleId: '',
    status: '',
    response: '',
  })

  const mode = hasSupabaseConfig ? 'supabase' : 'demo'

  useEffect(() => {
    if (mode === 'demo') {
      const savedProfileId = localStorage.getItem(DEMO_USER_KEY)
      if (savedProfileId) {
        const existing = demoState.profiles.find((item) => item.id === savedProfileId)
        if (existing) {
          setProfile(existing)
          setActiveTab(existing.role === 'driver' ? 'today' : 'dashboard')
        }
      }
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth.getSession().then(async ({ data, error: authError }) => {
      if (!mounted) return
      if (authError) {
        setError(authError.message)
        setLoading(false)
        return
      }
      setSession(data.session)
      if (data.session) {
        await hydrateSupabaseUser(data.session.user.id)
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        await hydrateSupabaseUser(nextSession.user.id)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mode === 'demo') persistDemoState(demoState)
  }, [demoState, mode])

  const state = useMemo(() => {
    if (mode === 'demo') return demoState
    return demoState
  }, [demoState, mode])

  const drivers = state.drivers ?? []
  const vehicles = state.vehicles ?? []
  const shifts = state.shifts ?? []
  const availability = state.availability ?? []
  const changeLog = state.changeLog ?? []
  const profiles = state.profiles ?? []

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((item) => [item.id, item])), [profiles])
  const driversMap = useMemo(() => Object.fromEntries(drivers.map((item) => [item.id, item])), [drivers])
  const vehiclesMap = useMemo(() => Object.fromEntries(vehicles.map((item) => [item.id, item])), [vehicles])
  const driverByProfileId = useMemo(() => Object.fromEntries(drivers.filter((item) => item.profile_id).map((item) => [item.profile_id, item])), [drivers])

  const currentDriver = profile?.role === 'driver' ? driverByProfileId[profile.id] : null

  const enrichedShifts = useMemo(() => {
    return [...shifts]
      .map((shift) => ({
        ...shift,
        driver: driversMap[shift.driver_id],
        vehicle: vehiclesMap[shift.vehicle_id],
      }))
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
  }, [shifts, driversMap, vehiclesMap])

  const visibleShifts = useMemo(() => {
    const base = profile?.role === 'driver' && currentDriver
      ? enrichedShifts.filter((shift) => shift.driver_id === currentDriver.id)
      : enrichedShifts

    return base.filter((shift) => {
      if (filters.driverId && shift.driver_id !== filters.driverId) return false
      if (filters.vehicleId && shift.vehicle_id !== filters.vehicleId) return false
      if (filters.status && shift.status !== filters.status) return false
      if (filters.response && shift.driver_response !== filters.response) return false
      return true
    })
  }, [currentDriver, enrichedShifts, filters, profile?.role])

  const todayShifts = useMemo(() => {
    const from = startOfDay(new Date())
    const to = endOfDay(new Date())
    return visibleShifts.filter((shift) => overlaps(shift.start_at, shift.end_at, from, to))
  }, [visibleShifts])

  const upcomingShift = useMemo(() => {
    const now = Date.now()
    return visibleShifts.find((shift) => new Date(shift.end_at).getTime() >= now)
  }, [visibleShifts])

  const problems = useMemo(() => getProblems(enrichedShifts), [enrichedShifts])
  const stats = useMemo(() => driverStats(enrichedShifts, drivers), [enrichedShifts, drivers])

  const groupedCalendar = useMemo(() => {
    const now = new Date()
    let start = startOfDay(now)
    let end = endOfDay(now)

    if (calendarView === 'week') {
      end = endOfDay(addDays(now, 6))
    }
    if (calendarView === 'month') {
      end = endOfDay(addDays(now, 29))
    }

    const items = visibleShifts.filter((shift) => overlaps(shift.start_at, shift.end_at, start, end))
    const groups = new Map()

    for (const shift of items) {
      const key = formatDate(shift.start_at)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(shift)
    }

    return [...groups.entries()]
  }, [calendarView, visibleShifts])

  async function hydrateSupabaseUser(userId) {
    setLoading(true)
    setError('')
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (profileError) {
      setError('Nepodařilo se načíst profil uživatele. Zkontroluj tabulku profiles a RLS politiky.')
      setLoading(false)
      return
    }

    setProfile(userProfile)
    setActiveTab(userProfile.role === 'driver' ? 'today' : 'dashboard')
    await fetchSupabaseData()
    setLoading(false)
  }

  async function fetchSupabaseData() {
    const [profilesRes, driversRes, vehiclesRes, shiftsRes, availabilityRes, changeLogRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('drivers').select('*').order('display_name'),
      supabase.from('vehicles').select('*').order('name'),
      supabase.from('shifts').select('*').order('start_at'),
      supabase.from('driver_availability').select('*').order('from_date'),
      supabase.from('change_log').select('*').order('created_at', { ascending: false }).limit(100),
    ])

    const results = [profilesRes, driversRes, vehiclesRes, shiftsRes, availabilityRes, changeLogRes]
    const firstError = results.find((item) => item.error)?.error
    if (firstError) {
      setError(firstError.message)
      return
    }

    setDemoState({
      profiles: profilesRes.data ?? [],
      drivers: driversRes.data ?? [],
      vehicles: vehiclesRes.data ?? [],
      shifts: shiftsRes.data ?? [],
      availability: availabilityRes.data ?? [],
      changeLog: changeLogRes.data ?? [],
    })
  }

  function resetForms() {
    setShiftForm(DEFAULT_SHIFT_FORM())
    setAvailabilityForm(DEFAULT_AVAILABILITY_FORM())
    setVehicleForm(DEFAULT_VEHICLE_FORM)
    setDriverForm(DEFAULT_DRIVER_FORM)
  }

  function setFlash(kind, text) {
    if (kind === 'error') {
      setError(text)
      setMessage('')
      return
    }
    setMessage(text)
    setError('')
  }

  function validateShift(form) {
    if (!form.driver_id) return 'Vyber řidiče.'
    if (!form.vehicle_id) return 'Vyber vozidlo.'
    if (!form.start_at || !form.end_at) return 'Vyplň začátek a konec směny.'
    if (new Date(form.end_at) <= new Date(form.start_at)) return 'Konec směny musí být po začátku.'

    const otherShifts = enrichedShifts.filter((item) => item.id !== form.id)
    const driverOverlap = otherShifts.find((item) => item.driver_id === form.driver_id && overlaps(item.start_at, item.end_at, form.start_at, form.end_at))
    if (driverOverlap) return 'Řidič už má v tomto čase jinou směnu.'

    const vehicleOverlap = otherShifts.find((item) => item.vehicle_id === form.vehicle_id && overlaps(item.start_at, item.end_at, form.start_at, form.end_at))
    if (vehicleOverlap) return 'Vozidlo je ve stejný čas už přiřazené jiné směně.'

    const selectedVehicle = vehiclesMap[form.vehicle_id]
    if (selectedVehicle?.status === 'service' && selectedVehicle.service_from && selectedVehicle.service_to) {
      if (overlaps(selectedVehicle.service_from, selectedVehicle.service_to, form.start_at, form.end_at)) {
        return 'Vybrané vozidlo je v servisu.'
      }
    }

    const availabilityConflict = availability.find((item) => item.driver_id === form.driver_id && item.availability_type !== 'available' && overlaps(item.from_date, item.to_date, form.start_at, form.end_at))
    if (availabilityConflict) {
      return `Řidič má v tomto termínu blokaci: ${AVAILABILITY_LABEL[availabilityConflict.availability_type]}.`
    }

    return ''
  }

  async function appendLog(entry) {
    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        changeLog: [{ id: generateId('log'), created_at: new Date().toISOString(), ...entry }, ...current.changeLog].slice(0, 200),
      }))
      return
    }

    await supabase.from('change_log').insert([{ id: generateId('log'), created_at: new Date().toISOString(), ...entry }])
  }

  async function handleSaveShift(event) {
    event.preventDefault()
    setBusy(true)
    const validation = validateShift(shiftForm)
    if (validation) {
      setFlash('error', validation)
      setBusy(false)
      return
    }

    const payload = {
      ...shiftForm,
      start_at: new Date(shiftForm.start_at).toISOString(),
      end_at: new Date(shiftForm.end_at).toISOString(),
      updated_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }

    const previous = shiftForm.id ? shifts.find((item) => item.id === shiftForm.id) : null

    if (mode === 'demo') {
      setDemoState((current) => {
        const nextShifts = shiftForm.id
          ? current.shifts.map((item) => (item.id === shiftForm.id ? { ...item, ...payload } : item))
          : [{ ...payload, id: generateId('shift'), created_by: profile?.id ?? null, created_at: new Date().toISOString() }, ...current.shifts]
        return { ...current, shifts: nextShifts }
      })
      await appendLog({
        entity_type: 'shift',
        entity_id: shiftForm.id ?? 'new',
        action: shiftForm.id ? 'updated' : 'created',
        old_data: previous ?? null,
        new_data: payload,
        user_id: profile?.id ?? null,
      })
      setFlash('success', shiftForm.id ? 'Směna byla upravena.' : 'Směna byla vytvořena.')
      setShiftForm(DEFAULT_SHIFT_FORM())
      setBusy(false)
      return
    }

    const query = shiftForm.id
      ? supabase.from('shifts').update(payload).eq('id', shiftForm.id)
      : supabase.from('shifts').insert([{ ...payload, created_by: profile?.id ?? null, created_at: new Date().toISOString() }])

    const { error: saveError } = await query
    if (saveError) {
      setFlash('error', saveError.message)
      setBusy(false)
      return
    }

    await appendLog({
      entity_type: 'shift',
      entity_id: shiftForm.id ?? 'new',
      action: shiftForm.id ? 'updated' : 'created',
      old_data: previous ?? null,
      new_data: payload,
      user_id: profile?.id ?? null,
    })
    await fetchSupabaseData()
    setShiftForm(DEFAULT_SHIFT_FORM())
    setFlash('success', shiftForm.id ? 'Směna byla upravena.' : 'Směna byla vytvořena.')
    setBusy(false)
  }

  async function handleDeleteShift(id) {
    if (!window.confirm('Opravdu smazat tuto směnu?')) return
    setBusy(true)

    const previous = shifts.find((item) => item.id === id)

    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        shifts: current.shifts.filter((item) => item.id !== id),
      }))
      await appendLog({ entity_type: 'shift', entity_id: id, action: 'deleted', old_data: previous, new_data: null, user_id: profile?.id ?? null })
      setFlash('success', 'Směna byla smazána.')
      setBusy(false)
      return
    }

    const { error: deleteError } = await supabase.from('shifts').delete().eq('id', id)
    if (deleteError) {
      setFlash('error', deleteError.message)
      setBusy(false)
      return
    }
    await appendLog({ entity_type: 'shift', entity_id: id, action: 'deleted', old_data: previous, new_data: null, user_id: profile?.id ?? null })
    await fetchSupabaseData()
    setFlash('success', 'Směna byla smazána.')
    setBusy(false)
  }

  async function handleShiftResponse(shift, response) {
    setBusy(true)
    const nextStatus = response === 'accepted' ? 'confirmed' : 'replacement_needed'
    const patch = {
      driver_response: response,
      status: nextStatus,
      updated_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }

    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        shifts: current.shifts.map((item) => (item.id === shift.id ? { ...item, ...patch } : item)),
      }))
      await appendLog({ entity_type: 'shift', entity_id: shift.id, action: 'response', old_data: shift, new_data: patch, user_id: profile?.id ?? null })
      setFlash('success', response === 'accepted' ? 'Směna potvrzena.' : 'Směna odmítnuta a označena pro záskok.')
      setBusy(false)
      return
    }

    const { error: updateError } = await supabase.from('shifts').update(patch).eq('id', shift.id)
    if (updateError) {
      setFlash('error', updateError.message)
      setBusy(false)
      return
    }
    await appendLog({ entity_type: 'shift', entity_id: shift.id, action: 'response', old_data: shift, new_data: patch, user_id: profile?.id ?? null })
    await fetchSupabaseData()
    setFlash('success', response === 'accepted' ? 'Směna potvrzena.' : 'Směna odmítnuta a označena pro záskok.')
    setBusy(false)
  }

  async function handleSaveAvailability(event) {
    event.preventDefault()
    setBusy(true)

    if (!availabilityForm.driver_id) {
      setFlash('error', 'Vyber řidiče.')
      setBusy(false)
      return
    }
    if (new Date(availabilityForm.to_date) < new Date(availabilityForm.from_date)) {
      setFlash('error', 'Konec blokace musí být po začátku.')
      setBusy(false)
      return
    }

    const payload = {
      ...availabilityForm,
      from_date: new Date(availabilityForm.from_date).toISOString(),
      to_date: new Date(availabilityForm.to_date).toISOString(),
    }

    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        availability: availabilityForm.id
          ? current.availability.map((item) => (item.id === availabilityForm.id ? { ...item, ...payload } : item))
          : [{ ...payload, id: generateId('availability') }, ...current.availability],
      }))
      await appendLog({ entity_type: 'availability', entity_id: availabilityForm.id ?? 'new', action: availabilityForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
      setAvailabilityForm(DEFAULT_AVAILABILITY_FORM())
      setFlash('success', 'Dostupnost byla uložena.')
      setBusy(false)
      return
    }

    const query = availabilityForm.id
      ? supabase.from('driver_availability').update(payload).eq('id', availabilityForm.id)
      : supabase.from('driver_availability').insert([{ ...payload }])

    const { error: saveError } = await query
    if (saveError) {
      setFlash('error', saveError.message)
      setBusy(false)
      return
    }
    await appendLog({ entity_type: 'availability', entity_id: availabilityForm.id ?? 'new', action: availabilityForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
    await fetchSupabaseData()
    setAvailabilityForm(DEFAULT_AVAILABILITY_FORM())
    setFlash('success', 'Dostupnost byla uložena.')
    setBusy(false)
  }

  async function handleSaveVehicle(event) {
    event.preventDefault()
    setBusy(true)
    if (!vehicleForm.name || !vehicleForm.plate) {
      setFlash('error', 'Vyplň název i SPZ vozidla.')
      setBusy(false)
      return
    }

    const payload = {
      ...vehicleForm,
      service_from: vehicleForm.service_from ? new Date(vehicleForm.service_from).toISOString() : null,
      service_to: vehicleForm.service_to ? new Date(vehicleForm.service_to).toISOString() : null,
    }

    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        vehicles: vehicleForm.id
          ? current.vehicles.map((item) => (item.id === vehicleForm.id ? { ...item, ...payload } : item))
          : [{ ...payload, id: generateId('vehicle') }, ...current.vehicles],
      }))
      await appendLog({ entity_type: 'vehicle', entity_id: vehicleForm.id ?? 'new', action: vehicleForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
      setVehicleForm(DEFAULT_VEHICLE_FORM)
      setFlash('success', 'Vozidlo bylo uloženo.')
      setBusy(false)
      return
    }

    const query = vehicleForm.id
      ? supabase.from('vehicles').update(payload).eq('id', vehicleForm.id)
      : supabase.from('vehicles').insert([{ ...payload }])

    const { error: saveError } = await query
    if (saveError) {
      setFlash('error', saveError.message)
      setBusy(false)
      return
    }
    await appendLog({ entity_type: 'vehicle', entity_id: vehicleForm.id ?? 'new', action: vehicleForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
    await fetchSupabaseData()
    setVehicleForm(DEFAULT_VEHICLE_FORM)
    setFlash('success', 'Vozidlo bylo uloženo.')
    setBusy(false)
  }

  async function handleSaveDriver(event) {
    event.preventDefault()
    setBusy(true)
    if (!driverForm.display_name) {
      setFlash('error', 'Vyplň jméno řidiče.')
      setBusy(false)
      return
    }

    const payload = {
      ...driverForm,
      profile_id: driverForm.profile_id || null,
    }

    if (mode === 'demo') {
      setDemoState((current) => ({
        ...current,
        drivers: driverForm.id
          ? current.drivers.map((item) => (item.id === driverForm.id ? { ...item, ...payload } : item))
          : [{ ...payload, id: generateId('driver') }, ...current.drivers],
      }))
      await appendLog({ entity_type: 'driver', entity_id: driverForm.id ?? 'new', action: driverForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
      setDriverForm(DEFAULT_DRIVER_FORM)
      setFlash('success', 'Řidič byl uložen.')
      setBusy(false)
      return
    }

    const query = driverForm.id
      ? supabase.from('drivers').update(payload).eq('id', driverForm.id)
      : supabase.from('drivers').insert([{ ...payload }])

    const { error: saveError } = await query
    if (saveError) {
      setFlash('error', saveError.message)
      setBusy(false)
      return
    }
    await appendLog({ entity_type: 'driver', entity_id: driverForm.id ?? 'new', action: driverForm.id ? 'updated' : 'created', old_data: null, new_data: payload, user_id: profile?.id ?? null })
    await fetchSupabaseData()
    setDriverForm(DEFAULT_DRIVER_FORM)
    setFlash('success', 'Řidič byl uložen.')
    setBusy(false)
  }

  async function handleLogin(event) {
    event.preventDefault()
    if (mode === 'demo') {
      const found = profiles.find((item) => item.email.toLowerCase() === loginEmail.toLowerCase())
      if (!found) {
        setFlash('error', 'Demo uživatel nenalezen. Použij připravené tlačítko níže.')
        return
      }
      setProfile(found)
      setActiveTab(found.role === 'driver' ? 'today' : 'dashboard')
      localStorage.setItem(DEMO_USER_KEY, found.id)
      setFlash('success', 'Přihlášení do demo režimu proběhlo úspěšně.')
      return
    }

    setBusy(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword })
    if (authError) {
      setFlash('error', authError.message)
      setBusy(false)
      return
    }
    setFlash('success', 'Přihlášení proběhlo úspěšně.')
    setBusy(false)
  }

  async function handleLogout() {
    if (mode === 'demo') {
      localStorage.removeItem(DEMO_USER_KEY)
      setProfile(null)
      setActiveTab('dashboard')
      resetForms()
      return
    }
    await supabase.auth.signOut()
    setProfile(null)
    resetForms()
  }

  function openShiftForEdit(shift) {
    setShiftForm({
      id: shift.id,
      driver_id: shift.driver_id,
      vehicle_id: shift.vehicle_id,
      start_at: toInputValue(shift.start_at),
      end_at: toInputValue(shift.end_at),
      shift_type: shift.shift_type,
      status: shift.status,
      driver_response: shift.driver_response,
      note: shift.note ?? '',
    })
    setActiveTab('shifts')
  }

  function openAvailabilityForEdit(item) {
    setAvailabilityForm({
      id: item.id,
      driver_id: item.driver_id,
      from_date: toInputValue(item.from_date),
      to_date: toInputValue(item.to_date),
      availability_type: item.availability_type,
      note: item.note ?? '',
    })
    setActiveTab('availability')
  }

  function openVehicleForEdit(item) {
    setVehicleForm({
      id: item.id,
      name: item.name,
      plate: item.plate,
      status: item.status,
      service_from: item.service_from ? toInputValue(item.service_from) : '',
      service_to: item.service_to ? toInputValue(item.service_to) : '',
      note: item.note ?? '',
    })
    setActiveTab('vehicles')
  }

  function openDriverForEdit(item) {
    setDriverForm({
      id: item.id,
      profile_id: item.profile_id ?? '',
      display_name: item.display_name,
      note: item.note ?? '',
      preferred_shift_types: item.preferred_shift_types ?? [],
      active: item.active,
    })
    setActiveTab('drivers')
  }

  const nav = profile?.role === 'driver'
    ? [
        { id: 'today', label: 'Dnes' },
        { id: 'my-shifts', label: 'Moje směny' },
        { id: 'availability', label: 'Dostupnost' },
      ]
    : [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'shifts', label: 'Směny' },
        { id: 'problems', label: 'Problémy' },
        { id: 'drivers', label: 'Řidiči' },
        { id: 'vehicles', label: 'Auta' },
        { id: 'availability', label: 'Nepřítomnosti' },
        { id: 'history', label: 'Historie' },
      ]

  if (loading) {
    return <div className="app-shell center-screen"><div className="loader-card">Načítám RBSHIFT…</div></div>
  }

  if (!profile) {
    return (
      <div className="app-shell auth-screen">
        <div className="auth-card">
          <div className="brand-block">
            <div className="brand-icon">RB</div>
            <div>
              <div className="eyebrow">PWA plánovač směn</div>
              <h1>RBSHIFT</h1>
              <p>
                Řidičská a dispečerská aplikace pro směny. Funguje jako demo hned po otevření a po doplnění
                `.env` může běžet nad Supabase.
              </p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              E-mail
              <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="např. dispecink@firma.cz" />
            </label>
            <label>
              Heslo
              <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder={mode === 'demo' ? 'V demo režimu není potřeba' : 'Heslo'} />
            </label>
            <button className="primary-button" disabled={busy}>{busy ? 'Přihlašuji…' : 'Přihlásit se'}</button>
          </form>

          {mode === 'demo' && (
            <div className="demo-grid">
              {demoUsers.map((user) => (
                <button
                  key={user.profileId}
                  className="demo-user"
                  type="button"
                  onClick={() => {
                    setLoginEmail(user.email)
                    const selected = profiles.find((item) => item.id === user.profileId)
                    if (selected) {
                      setProfile(selected)
                      setActiveTab(selected.role === 'driver' ? 'today' : 'dashboard')
                      localStorage.setItem(DEMO_USER_KEY, selected.id)
                    }
                  }}
                >
                  <strong>{user.label}</strong>
                  <span>{user.email}</span>
                </button>
              ))}
            </div>
          )}

          <div className="notice-row">
            <StatusPill tone={mode === 'demo' ? 'warning' : 'success'}>{mode === 'demo' ? 'Demo režim bez Supabase' : 'Supabase připojeno'}</StatusPill>
            <span className="muted">V ostrém provozu použij Vercel + Supabase Auth + RLS.</span>
          </div>

          {error && <div className="banner error">{error}</div>}
          {message && <div className="banner success">{message}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Plánovač směn pro řidiče a dispečink</div>
          <h1>RBSHIFT</h1>
        </div>
        <div className="topbar-actions">
          <StatusPill tone={mode === 'demo' ? 'warning' : 'success'}>{mode === 'demo' ? 'Demo' : 'Supabase'}</StatusPill>
          <StatusPill>{ROLE_LABEL[profile.role]}</StatusPill>
          <button className="ghost-button" onClick={handleLogout}>Odhlásit</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="profile-card">
            <strong>{profile.full_name}</strong>
            <span>{profile.email}</span>
            <span className="muted">{ROLE_LABEL[profile.role]}</span>
          </div>

          <nav className="nav-list">
            {nav.map((item) => (
              <button key={item.id} className={cx('nav-button', activeTab === item.id && 'active')} onClick={() => setActiveTab(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-note">
            <strong>PWA poznámka</strong>
            <p>Na mobilu si aplikaci přidej na plochu přes Sdílet → Přidat na plochu.</p>
          </div>
        </aside>

        <main className="content">
          {error && <div className="banner error">{error}</div>}
          {message && <div className="banner success">{message}</div>}

          {profile.role === 'driver' ? (
            <DriverView
              activeTab={activeTab}
              currentDriver={currentDriver}
              upcomingShift={upcomingShift}
              visibleShifts={visibleShifts}
              availability={availability}
              onRespond={handleShiftResponse}
              onAvailabilityEdit={openAvailabilityForEdit}
              availabilityForm={availabilityForm}
              setAvailabilityForm={setAvailabilityForm}
              onSaveAvailability={handleSaveAvailability}
              driversMap={driversMap}
              vehiclesMap={vehiclesMap}
              busy={busy}
            />
          ) : (
            <DispatcherView
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              shifts={enrichedShifts}
              todayShifts={todayShifts}
              problems={problems}
              stats={stats}
              drivers={drivers}
              vehicles={vehicles}
              availability={availability}
              changeLog={changeLog}
              filters={filters}
              setFilters={setFilters}
              calendarView={calendarView}
              setCalendarView={setCalendarView}
              groupedCalendar={groupedCalendar}
              shiftForm={shiftForm}
              setShiftForm={setShiftForm}
              onSaveShift={handleSaveShift}
              onDeleteShift={handleDeleteShift}
              onEditShift={openShiftForEdit}
              availabilityForm={availabilityForm}
              setAvailabilityForm={setAvailabilityForm}
              onSaveAvailability={handleSaveAvailability}
              onAvailabilityEdit={openAvailabilityForEdit}
              vehicleForm={vehicleForm}
              setVehicleForm={setVehicleForm}
              onSaveVehicle={handleSaveVehicle}
              onVehicleEdit={openVehicleForEdit}
              driverForm={driverForm}
              setDriverForm={setDriverForm}
              onSaveDriver={handleSaveDriver}
              onDriverEdit={openDriverForEdit}
              profiles={profiles}
              driversMap={driversMap}
              vehiclesMap={vehiclesMap}
              busy={busy}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function DriverView({
  activeTab,
  currentDriver,
  upcomingShift,
  visibleShifts,
  availability,
  onRespond,
  availabilityForm,
  setAvailabilityForm,
  onSaveAvailability,
  vehiclesMap,
  busy,
}) {
  const myAvailability = availability.filter((item) => item.driver_id === currentDriver?.id)
  const [selectedShiftId, setSelectedShiftId] = useState('')

  useEffect(() => {
    const availableIds = visibleShifts.map((item) => item.id)
    if (!availableIds.length) {
      setSelectedShiftId('')
      return
    }

    if (upcomingShift?.id && availableIds.includes(upcomingShift.id)) {
      setSelectedShiftId((current) => (current && availableIds.includes(current) ? current : upcomingShift.id))
      return
    }

    setSelectedShiftId((current) => (current && availableIds.includes(current) ? current : availableIds[0]))
  }, [upcomingShift?.id, visibleShifts])

  const selectedShift =
    visibleShifts.find((shift) => shift.id === selectedShiftId) ??
    upcomingShift ??
    visibleShifts[0] ??
    null

  const selectableShifts = useMemo(() => {
    if (!selectedShift) return visibleShifts.slice(0, 4)
    const others = visibleShifts.filter((shift) => shift.id !== selectedShift.id)
    return [selectedShift, ...others].slice(0, 4)
  }, [selectedShift, visibleShifts])

  if (!currentDriver) {
    return <div className="panel">K tomuto profilu zatím není přiřazen řidičský záznam.</div>
  }

  if (activeTab === 'today') {
    return (
      <div className="stack-xl">
        <div className="hero-card">
          <div>
            <div className="eyebrow">Moje vybraná směna</div>
            <h2>{selectedShift ? SHIFT_TYPE_LABEL[selectedShift.shift_type] : 'Dnes bez směny'}</h2>
            <p>
              {selectedShift
                ? `${formatDate(selectedShift.start_at, { weekday: 'long' })} · ${formatTime(selectedShift.start_at)}–${formatTime(selectedShift.end_at)}`
                : 'Aktuálně nemáš přiřazenou směnu.'}
            </p>
          </div>
          {selectedShift && (
            <StatusPill
              tone={
                selectedShift.driver_response === 'accepted'
                  ? 'success'
                  : selectedShift.driver_response === 'declined'
                    ? 'danger'
                    : 'warning'
              }
            >
              {RESPONSE_LABEL[selectedShift.driver_response]}
            </StatusPill>
          )}
        </div>

        {selectedShift ? (
          <div className="grid-2">
            <section className="panel">
              <h3>Detail směny</h3>
              <InfoRow label="Auto" value={`${selectedShift.vehicle?.name ?? '—'} · ${selectedShift.vehicle?.plate ?? '—'}`} />
              <InfoRow label="Stav směny" value={STATUS_LABEL[selectedShift.status]} />
              <InfoRow label="Poznámka" value={selectedShift.note || 'Bez poznámky'} />
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={busy || selectedShift.driver_response === 'accepted'}
                  onClick={() => onRespond(selectedShift, 'accepted')}
                >
                  Potvrdit směnu
                </button>
                <button
                  className="danger-button"
                  disabled={busy || selectedShift.driver_response === 'declined'}
                  onClick={() => onRespond(selectedShift, 'declined')}
                >
                  Odmítnout
                </button>
              </div>
            </section>
            <section className="panel">
              <h3>Další směny</h3>
              <div className="stack-md">
                {selectableShifts.map((shift) => (
                  <ShiftListItem
                    key={shift.id}
                    shift={shift}
                    compact
                    clickable
                    active={shift.id === selectedShift.id}
                    onClick={() => setSelectedShiftId(shift.id)}
                  />
                ))}
              </div>
              <p className="muted">Klikni na směnu vpravo a otevře se vlevo pro potvrzení nebo odmítnutí.</p>
            </section>
          </div>
        ) : null}
      </div>
    )
  }

  if (activeTab === 'availability') {
    return (
      <div className="grid-2">
        <section className="panel">
          <h3>Moje dostupnost</h3>
          <form className="form-grid" onSubmit={onSaveAvailability}>
            <input type="hidden" value={availabilityForm.id ?? ''} />
            <label>
              Řidič
              <input value={currentDriver.display_name} disabled />
            </label>
            <label>
              Typ
              <select value={availabilityForm.availability_type} onChange={(event) => setAvailabilityForm((current) => ({ ...current, driver_id: currentDriver.id, availability_type: event.target.value }))}>
                {Object.entries(AVAILABILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Od
              <input type="datetime-local" value={availabilityForm.from_date} onChange={(event) => setAvailabilityForm((current) => ({ ...current, driver_id: currentDriver.id, from_date: event.target.value }))} />
            </label>
            <label>
              Do
              <input type="datetime-local" value={availabilityForm.to_date} onChange={(event) => setAvailabilityForm((current) => ({ ...current, driver_id: currentDriver.id, to_date: event.target.value }))} />
            </label>
            <label className="full-width">
              Poznámka
              <textarea rows="3" value={availabilityForm.note} onChange={(event) => setAvailabilityForm((current) => ({ ...current, driver_id: currentDriver.id, note: event.target.value }))} />
            </label>
            <button className="primary-button" disabled={busy}>Uložit dostupnost</button>
          </form>
        </section>
        <section className="panel">
          <h3>Moje blokace</h3>
          <div className="stack-md">
            {myAvailability.length === 0 ? <EmptyState text="Zatím nemáš žádnou zadanou nepřítomnost." /> : myAvailability.map((item) => (
              <div className="list-card" key={item.id}>
                <div>
                  <strong>{AVAILABILITY_LABEL[item.availability_type]}</strong>
                  <p>{formatDateTime(item.from_date)} — {formatDateTime(item.to_date)}</p>
                  <p className="muted">{item.note || 'Bez poznámky'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Moje směny</h3>
          <p className="muted">Přehled dneška, zítřka a dalších plánovaných jízd.</p>
        </div>
      </div>
      <div className="stack-md">
        {visibleShifts.length === 0 ? <EmptyState text="Zatím nemáš žádné směny." /> : visibleShifts.map((shift) => (
          <div className="list-card" key={shift.id}>
            <div>
              <strong>{SHIFT_TYPE_LABEL[shift.shift_type]} · {formatDate(shift.start_at, { weekday: 'long' })}</strong>
              <p>{formatTime(shift.start_at)}–{formatTime(shift.end_at)} · {vehiclesMap[shift.vehicle_id]?.plate ?? 'Bez auta'}</p>
              <p className="muted">{shift.note || 'Bez poznámky'}</p>
            </div>
            <div className="button-row">
              <StatusPill tone={shift.driver_response === 'accepted' ? 'success' : shift.driver_response === 'declined' ? 'danger' : 'warning'}>{RESPONSE_LABEL[shift.driver_response]}</StatusPill>
              <button className="ghost-button" type="button" onClick={() => setSelectedShiftId(shift.id)}>
                Otevřít v detailu
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DispatcherView(props) {
  const {
    activeTab,
    shifts,
    todayShifts,
    problems,
    stats,
    drivers,
    vehicles,
    availability,
    changeLog,
    filters,
    setFilters,
    calendarView,
    setCalendarView,
    groupedCalendar,
    shiftForm,
    setShiftForm,
    onSaveShift,
    onDeleteShift,
    onEditShift,
    availabilityForm,
    setAvailabilityForm,
    onSaveAvailability,
    onAvailabilityEdit,
    vehicleForm,
    setVehicleForm,
    onSaveVehicle,
    onVehicleEdit,
    driverForm,
    setDriverForm,
    onSaveDriver,
    onDriverEdit,
    profiles,
    busy,
  } = props

  if (activeTab === 'dashboard') {
    return (
      <div className="stack-xl">
        <section className="stats-grid">
          <StatCard label="Dnešní směny" value={todayShifts.length} />
          <StatCard label="Nepotvrzené" value={shifts.filter((item) => item.driver_response === 'pending').length} tone="warning" />
          <StatCard label="Potřeba záskoku" value={shifts.filter((item) => item.status === 'replacement_needed').length} tone="danger" />
          <StatCard label="Auta v servisu" value={vehicles.filter((item) => item.status === 'service').length} tone="info" />
        </section>

        <div className="grid-2">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Dnešní provoz</h3>
                <p className="muted">Rychlý přehled směn, které běží dnes.</p>
              </div>
            </div>
            <div className="stack-md">
              {todayShifts.length === 0 ? <EmptyState text="Pro dnešek zatím nejsou žádné směny." /> : todayShifts.map((shift) => <ShiftListItem key={shift.id} shift={shift} />)}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Vytížení řidičů</h3>
                <p className="muted">Souhrn podle počtu směn a hodin.</p>
              </div>
            </div>
            <div className="stack-md">
              {stats.map((item) => (
                <div className="list-card" key={item.driver.id}>
                  <div>
                    <strong>{item.driver.display_name}</strong>
                    <p>{item.count} směn · {item.hours.toFixed(1)} h · noční {item.nights}×</p>
                  </div>
                  <StatusPill>{item.weekends} víkendy</StatusPill>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (activeTab === 'shifts') {
    return (
      <div className="grid-main">
        <section className="panel sticky-panel">
          <div className="panel-header">
            <div>
              <h3>{shiftForm.id ? 'Upravit směnu' : 'Nová směna'}</h3>
              <p className="muted">Systém hlídá kolize řidičů, aut i servisních blokací.</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={onSaveShift}>
            <label>
              Řidič
              <select value={shiftForm.driver_id} onChange={(event) => setShiftForm((current) => ({ ...current, driver_id: event.target.value }))}>
                <option value="">Vyber řidiče</option>
                {drivers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
              </select>
            </label>
            <label>
              Vozidlo
              <select value={shiftForm.vehicle_id} onChange={(event) => setShiftForm((current) => ({ ...current, vehicle_id: event.target.value }))}>
                <option value="">Vyber auto</option>
                {vehicles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.plate}</option>)}
              </select>
            </label>
            <label>
              Začátek
              <input type="datetime-local" value={shiftForm.start_at} onChange={(event) => setShiftForm((current) => ({ ...current, start_at: event.target.value }))} />
            </label>
            <label>
              Konec
              <input type="datetime-local" value={shiftForm.end_at} onChange={(event) => setShiftForm((current) => ({ ...current, end_at: event.target.value }))} />
            </label>
            <label>
              Typ směny
              <select value={shiftForm.shift_type} onChange={(event) => setShiftForm((current) => ({ ...current, shift_type: event.target.value }))}>
                {Object.entries(SHIFT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Stav
              <select value={shiftForm.status} onChange={(event) => setShiftForm((current) => ({ ...current, status: event.target.value }))}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Reakce řidiče
              <select value={shiftForm.driver_response} onChange={(event) => setShiftForm((current) => ({ ...current, driver_response: event.target.value }))}>
                {Object.entries(RESPONSE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="full-width">
              Poznámka
              <textarea rows="4" value={shiftForm.note} onChange={(event) => setShiftForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
            <div className="button-row full-width">
              <button className="primary-button" disabled={busy}>{shiftForm.id ? 'Uložit změny' : 'Vytvořit směnu'}</button>
              {shiftForm.id && <button className="ghost-button" type="button" onClick={() => setShiftForm(DEFAULT_SHIFT_FORM())}>Nová směna</button>}
            </div>
          </form>
        </section>

        <section className="stack-xl">
          <section className="panel">
            <div className="panel-header wrap">
              <div>
                <h3>Kalendář směn</h3>
                <p className="muted">Denní, týdenní nebo měsíční pohled s filtry.</p>
              </div>
              <div className="button-row wrap">
                {['day', 'week', 'month'].map((view) => (
                  <button key={view} className={cx('ghost-button', calendarView === view && 'active-pill')} onClick={() => setCalendarView(view)}>{view === 'day' ? 'Den' : view === 'week' ? 'Týden' : 'Měsíc'}</button>
                ))}
              </div>
            </div>

            <div className="filters-grid">
              <select value={filters.driverId} onChange={(event) => setFilters((current) => ({ ...current, driverId: event.target.value }))}>
                <option value="">Všichni řidiči</option>
                {drivers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
              </select>
              <select value={filters.vehicleId} onChange={(event) => setFilters((current) => ({ ...current, vehicleId: event.target.value }))}>
                <option value="">Všechna auta</option>
                {vehicles.map((item) => <option key={item.id} value={item.id}>{item.plate}</option>)}
              </select>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">Všechny stavy</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={filters.response} onChange={(event) => setFilters((current) => ({ ...current, response: event.target.value }))}>
                <option value="">Všechny reakce</option>
                {Object.entries(RESPONSE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            <div className="stack-lg">
              {groupedCalendar.length === 0 ? <EmptyState text="Pro vybrané období nejsou žádné směny." /> : groupedCalendar.map(([day, items]) => (
                <div key={day} className="day-group">
                  <div className="day-title">{day}</div>
                  <div className="stack-md">
                    {items.map((shift) => (
                      <div className="list-card" key={shift.id}>
                        <div>
                          <strong>{shift.driver?.display_name ?? 'Bez řidiče'} · {shift.vehicle?.plate ?? 'Bez auta'}</strong>
                          <p>{formatTime(shift.start_at)}–{formatTime(shift.end_at)} · {SHIFT_TYPE_LABEL[shift.shift_type]}</p>
                          <p className="muted">{shift.note || 'Bez poznámky'}</p>
                        </div>
                        <div className="button-row wrap">
                          <StatusPill tone={shift.driver_response === 'accepted' ? 'success' : shift.driver_response === 'declined' ? 'danger' : 'warning'}>{RESPONSE_LABEL[shift.driver_response]}</StatusPill>
                          <button className="ghost-button" onClick={() => onEditShift(shift)}>Upravit</button>
                          <button className="danger-button" onClick={() => onDeleteShift(shift.id)}>Smazat</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    )
  }

  if (activeTab === 'problems') {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Problémové směny</h3>
            <p className="muted">Čekající na potvrzení, odmítnuté nebo bez obsazení.</p>
          </div>
        </div>
        <div className="stack-md">
          {problems.length === 0 ? <EmptyState text="Skvělé, momentálně nejsou evidované žádné problémové směny." /> : problems.map((shift) => (
            <div className="list-card" key={shift.id}>
              <div>
                <strong>{shift.driver?.display_name ?? 'Bez řidiče'} · {formatDate(shift.start_at, { weekday: 'long' })}</strong>
                <p>{formatTime(shift.start_at)}–{formatTime(shift.end_at)} · {shift.vehicle?.plate ?? 'Bez auta'}</p>
                <p className="muted">{shift.note || 'Bez poznámky'}</p>
              </div>
              <div className="button-row wrap">
                <StatusPill tone={shift.status === 'replacement_needed' || shift.driver_response === 'declined' ? 'danger' : 'warning'}>
                  {shift.status === 'replacement_needed' ? 'Záskok' : RESPONSE_LABEL[shift.driver_response]}
                </StatusPill>
                <button className="ghost-button" onClick={() => onEditShift(shift)}>Otevřít</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (activeTab === 'drivers') {
    return (
      <div className="grid-2">
        <section className="panel">
          <h3>{driverForm.id ? 'Upravit řidiče' : 'Nový řidič'}</h3>
          <form className="form-grid" onSubmit={onSaveDriver}>
            <label>
              Jméno
              <input value={driverForm.display_name} onChange={(event) => setDriverForm((current) => ({ ...current, display_name: event.target.value }))} />
            </label>
            <label>
              Napojení na profil
              <select value={driverForm.profile_id} onChange={(event) => setDriverForm((current) => ({ ...current, profile_id: event.target.value }))}>
                <option value="">Bez vazby</option>
                {profiles.filter((item) => item.role === 'driver').map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
              </select>
            </label>
            <label className="full-width">
              Preferované směny
              <div className="checkbox-row">
                {Object.entries(SHIFT_TYPE_LABEL).filter(([key]) => key !== 'custom').map(([value, label]) => (
                  <label key={value} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={driverForm.preferred_shift_types.includes(value)}
                      onChange={(event) => setDriverForm((current) => ({
                        ...current,
                        preferred_shift_types: event.target.checked
                          ? [...current.preferred_shift_types, value]
                          : current.preferred_shift_types.filter((item) => item !== value),
                      }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </label>
            <label className="full-width">
              Poznámka
              <textarea rows="3" value={driverForm.note} onChange={(event) => setDriverForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
            <button className="primary-button" disabled={busy}>Uložit řidiče</button>
          </form>
        </section>
        <section className="panel">
          <h3>Seznam řidičů</h3>
          <div className="stack-md">
            {drivers.map((item) => (
              <div className="list-card" key={item.id}>
                <div>
                  <strong>{item.display_name}</strong>
                  <p>{(item.preferred_shift_types ?? []).map((value) => SHIFT_TYPE_LABEL[value]).join(', ') || 'Bez preferencí'}</p>
                  <p className="muted">{item.note || 'Bez poznámky'}</p>
                </div>
                <button className="ghost-button" onClick={() => onDriverEdit(item)}>Upravit</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  if (activeTab === 'vehicles') {
    return (
      <div className="grid-2">
        <section className="panel">
          <h3>{vehicleForm.id ? 'Upravit vozidlo' : 'Nové vozidlo'}</h3>
          <form className="form-grid" onSubmit={onSaveVehicle}>
            <label>
              Název vozu
              <input value={vehicleForm.name} onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              SPZ
              <input value={vehicleForm.plate} onChange={(event) => setVehicleForm((current) => ({ ...current, plate: event.target.value }))} />
            </label>
            <label>
              Stav
              <select value={vehicleForm.status} onChange={(event) => setVehicleForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Aktivní</option>
                <option value="service">V servisu</option>
                <option value="inactive">Mimo provoz</option>
              </select>
            </label>
            <label>
              Servis od
              <input type="datetime-local" value={vehicleForm.service_from} onChange={(event) => setVehicleForm((current) => ({ ...current, service_from: event.target.value }))} />
            </label>
            <label>
              Servis do
              <input type="datetime-local" value={vehicleForm.service_to} onChange={(event) => setVehicleForm((current) => ({ ...current, service_to: event.target.value }))} />
            </label>
            <label className="full-width">
              Poznámka
              <textarea rows="3" value={vehicleForm.note} onChange={(event) => setVehicleForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
            <button className="primary-button" disabled={busy}>Uložit vozidlo</button>
          </form>
        </section>
        <section className="panel">
          <h3>Vozový park</h3>
          <div className="stack-md">
            {vehicles.map((item) => (
              <div className="list-card" key={item.id}>
                <div>
                  <strong>{item.name} · {item.plate}</strong>
                  <p>{item.status === 'service' ? 'V servisu' : item.status === 'inactive' ? 'Mimo provoz' : 'Aktivní'}</p>
                  <p className="muted">{item.note || 'Bez poznámky'}</p>
                </div>
                <button className="ghost-button" onClick={() => onVehicleEdit(item)}>Upravit</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  if (activeTab === 'availability') {
    return (
      <div className="grid-2">
        <section className="panel">
          <h3>{availabilityForm.id ? 'Upravit nepřítomnost' : 'Nová nepřítomnost'}</h3>
          <form className="form-grid" onSubmit={onSaveAvailability}>
            <label>
              Řidič
              <select value={availabilityForm.driver_id} onChange={(event) => setAvailabilityForm((current) => ({ ...current, driver_id: event.target.value }))}>
                <option value="">Vyber řidiče</option>
                {drivers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
              </select>
            </label>
            <label>
              Typ
              <select value={availabilityForm.availability_type} onChange={(event) => setAvailabilityForm((current) => ({ ...current, availability_type: event.target.value }))}>
                {Object.entries(AVAILABILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Od
              <input type="datetime-local" value={availabilityForm.from_date} onChange={(event) => setAvailabilityForm((current) => ({ ...current, from_date: event.target.value }))} />
            </label>
            <label>
              Do
              <input type="datetime-local" value={availabilityForm.to_date} onChange={(event) => setAvailabilityForm((current) => ({ ...current, to_date: event.target.value }))} />
            </label>
            <label className="full-width">
              Poznámka
              <textarea rows="3" value={availabilityForm.note} onChange={(event) => setAvailabilityForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
            <button className="primary-button" disabled={busy}>Uložit nepřítomnost</button>
          </form>
        </section>
        <section className="panel">
          <h3>Evidence nepřítomností</h3>
          <div className="stack-md">
            {availability.length === 0 ? <EmptyState text="Zatím nejsou zadané žádné nepřítomnosti." /> : availability.map((item) => (
              <div className="list-card" key={item.id}>
                <div>
                  <strong>{drivers.find((driver) => driver.id === item.driver_id)?.display_name ?? 'Neznámý řidič'}</strong>
                  <p>{AVAILABILITY_LABEL[item.availability_type]} · {formatDateTime(item.from_date)} — {formatDateTime(item.to_date)}</p>
                  <p className="muted">{item.note || 'Bez poznámky'}</p>
                </div>
                <button className="ghost-button" onClick={() => onAvailabilityEdit(item)}>Upravit</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Historie změn</h3>
          <p className="muted">Audit log pro dohledání změn ve směnách, autech a dostupnosti.</p>
        </div>
      </div>
      <div className="stack-md">
        {changeLog.length === 0 ? <EmptyState text="Zatím nebyly zaznamenány žádné změny." /> : changeLog.map((item) => (
          <div className="list-card" key={item.id}>
            <div>
              <strong>{item.entity_type} · {item.action}</strong>
              <p>{formatDateTime(item.created_at)}</p>
              <p className="muted">Uživatel: {profiles.find((profile) => profile.id === item.user_id)?.full_name ?? item.user_id ?? '—'}</p>
            </div>
            <StatusPill>{item.entity_type}</StatusPill>
          </div>
        ))}
      </div>
    </section>
  )
}

function ShiftListItem({ shift, compact = false, clickable = false, active = false, onClick }) {
  const handleActivate = () => {
    if (onClick) onClick()
  }

  const handleKeyDown = (event) => {
    if (!clickable) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleActivate()
    }
  }

  return (
    <div
      className={cx('list-card', compact && 'compact', clickable && 'clickable-card', active && 'active-card')}
      onClick={clickable ? handleActivate : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? active : undefined}
    >
      <div>
        <strong>{shift.driver?.display_name ?? 'Bez řidiče'} · {SHIFT_TYPE_LABEL[shift.shift_type]}</strong>
        <p>{formatDate(shift.start_at, { weekday: 'long' })} · {formatTime(shift.start_at)}–{formatTime(shift.end_at)}</p>
        <p className="muted">{shift.vehicle?.name ?? 'Bez auta'} · {shift.vehicle?.plate ?? '—'}</p>
      </div>
      <StatusPill tone={shift.driver_response === 'accepted' ? 'success' : shift.driver_response === 'declined' ? 'danger' : 'warning'}>{RESPONSE_LABEL[shift.driver_response]}</StatusPill>
    </div>
  )
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={cx('pill', `pill-${tone}`)}>{children}</span>
}

function StatCard({ label, value, tone = 'neutral' }) {
  return (
    <div className="stat-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      <span className={cx('stat-dot', `stat-dot-${tone}`)} />
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>
}

export default App
