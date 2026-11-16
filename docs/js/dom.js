// Small DOM helpers shared by the other modules.

export const $ = (id) => document.getElementById(id)

/** Appends one <option> per value to a <select>. */
export function fillSelect(id, values) {
  for (const value of values) $(id).add(new Option(value, value))
}

/** Replaces the children of a list with one <li> per entry. */
export function setList(id, entries) {
  const list = $(id)
  list.replaceChildren()
  for (const { text, className } of entries) {
    const li = document.createElement('li')
    li.className = className
    li.textContent = text
    list.append(li)
  }
}

/** Saves content as a file through a temporary link. */
export function download(name, type, content) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

/** Copies text and briefly shows a confirmation on the button. */
export async function copyWithFeedback(button, text) {
  await navigator.clipboard.writeText(text)
  const label = button.textContent
  button.textContent = 'Copied'
  setTimeout(() => (button.textContent = label), 1200)
}
