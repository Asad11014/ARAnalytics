// Streams an SSE report endpoint, calling onProgress for each progress event.
// Resolves with the final `done` event payload.
export function fetchReportSSE(url, onProgress) {
  return new Promise((resolve, reject) => {
    fetch(url).then(res => {
      if (!res.ok) { reject(new Error(`HTTP ${res.status}`)); return }
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) return
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const msg = JSON.parse(line.slice(6))
              if (msg.type === 'progress') { onProgress?.(msg) }
              else if (msg.type === 'done')  { resolve(msg); return }
              else if (msg.type === 'error') { reject(new Error(msg.message)); return }
            } catch {}
          }
          read()
        }).catch(reject)
      }
      read()
    }).catch(reject)
  })
}
