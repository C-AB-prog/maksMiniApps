<script>
async function chatSend(){
  var inp = document.querySelector('#chatInput');
  var v = (inp.value || '').trim();
  if(!v) return;

  appendMsg('me', v);
  inp.value = '';

  try {
    const r = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify({ message: v, user_id: 'demo' })
    });
    const data = await r.json();
    appendMsg('bot', data.reply || '...');
  } catch(e){
    appendMsg('bot', 'Сервис недоступен. Попробуйте позже.');
  }
}
</script>
