// Supabase Edge Function: admin-api
// للعمليات الي محتاجة صلاحية السيرفر: إضافة طالب / تغيير باسورد طالب / حذف طالب
// Deploy: Dashboard -> Edge Functions -> Deploy a new function -> الاسم: admin-api -> الصق الكود ده
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) تأكد إن الي بينادي هو الأدمن
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(url, svc)
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') return json({ error: 'forbidden' }, 403)

    const b = await req.json()

    if (b.action === 'create') {
      if (!b.email || !b.password || String(b.password).length < 6) return json({ error: 'بيانات ناقصة' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email: b.email, password: b.password, email_confirm: true,
        user_metadata: { name: b.name, grade: b.grade, grp: b.grp },
      })
      if (error) return json({ error: error.message }, 400)
      return json({ id: data.user?.id })
    }

    if (b.action === 'reset') {
      if (!b.id || !b.password || String(b.password).length < 6) return json({ error: 'بيانات ناقصة' }, 400)
      const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (b.action === 'delete') {
      if (!b.id || b.id === user.id) return json({ error: 'غير مسموح' }, 400)
      // امسح ملفات الطالب (صورته والبانر)
      const { data: files } = await admin.storage.from('avatars').list(b.id)
      if (files?.length) await admin.storage.from('avatars').remove(files.map((f) => `${b.id}/${f.name}`))
      const { error } = await admin.auth.admin.deleteUser(b.id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
