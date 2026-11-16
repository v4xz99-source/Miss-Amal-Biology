// Supabase Edge Function: admin-api
// للعمليات الي محتاجة صلاحية السيرفر: إضافة طالب / تغيير باسورد طالب / حذف طالب / إرسال إشعار بفيديو جديد
// Deploy: Dashboard -> Edge Functions -> admin-api -> الصق الكود ده -> Deploy
// الإشعارات محتاجة 3 Secrets: VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY و VAPID_SUBJECT (راجع SETUP.md)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

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
        user_metadata: { name: b.name, grade: b.grade, grp: b.grp, phone: b.phone, parent_phone: b.parent_phone },
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

    // إرسال إشعار للطلاب المعنيين بمحتوى جديد
    if (b.action === 'notify') {
      const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY')
      if (!pub || !priv) return json({ error: 'مفاتيح الإشعارات (VAPID) مش متضافة في Secrets' }, 400)
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv)

      const { data: c } = await admin.from('content').select('id,title,grade,grp').eq('id', b.id).single()
      if (!c) return json({ error: 'المحتوى غير موجود' }, 404)

      let q = admin.from('profiles').select('id').eq('role', 'student').eq('blocked', false)
      if (c.grade !== 'all') q = q.eq('grade', c.grade)
      if (c.grp !== 'all') q = q.eq('grp', c.grp)
      const { data: studs } = await q
      const ids = (studs ?? []).map((s: { id: string }) => s.id)
      if (!ids.length) return json({ students: 0, devices: 0, sent: 0, failed: 0 })

      const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', ids)
      const list = subs ?? []
      const payload = JSON.stringify({
        title: 'Miss Amal Biology 🧬',
        body: `تم رفع محتوى جديد: ${c.title}`,
        tag: `content-${c.id}`,
      })

      let sent = 0, failed = 0
      const dead: string[] = []
      for (let i = 0; i < list.length; i += 40) {
        const res = await Promise.allSettled(list.slice(i, i + 40).map((s: { endpoint: string; p256dh: string; auth: string }) =>
          webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 })))
        res.forEach((r, j) => {
          if (r.status === 'fulfilled') sent++
          else {
            failed++
            const code = (r.reason as { statusCode?: number })?.statusCode
            if (code === 404 || code === 410) dead.push(list[i + j].endpoint)   // الاشتراك انتهى
          }
        })
      }
      if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)
      return json({ students: ids.length, devices: list.length, sent, failed })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
