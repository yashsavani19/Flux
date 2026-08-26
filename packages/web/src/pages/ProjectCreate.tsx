import { useState } from 'preact/hooks'
import { route, RoutableProps } from 'preact-router'
import { createProject } from '../stores'

export function ProjectCreate(_props: RoutableProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    const project = await createProject(name.trim(), description.trim() || undefined)
    route(`/board/${project.id}`)
  }

  return (
    <div class="min-h-screen bg-base-200 flex items-center justify-center">
      <div class="card w-96 bg-base-100 shadow-xl">
        <div class="card-body">
          <h2 class="card-title text-2xl mb-4">Create project</h2>
          <form onSubmit={handleSubmit}>
            <div class="form-control mb-4">
              <label class="label">
                <span class="label-text">Project name *</span>
              </label>
              <input
                type="text"
                placeholder="My kanban project"
                class="input input-bordered w-full"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                required
              />
            </div>
            <div class="form-control mb-6">
              <label class="label">
                <span class="label-text">Description</span>
              </label>
              <textarea
                placeholder="Optional description..."
                class="textarea textarea-bordered w-full"
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              />
            </div>
            <div class="card-actions justify-end">
              <button type="button" class="btn btn-ghost" onClick={() => route('/')}>
                Cancel
              </button>
              <button type="submit" class="btn btn-primary" disabled={!name.trim() || submitting}>
                {submitting ? <span class="loading loading-spinner loading-sm"></span> : 'Create project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
