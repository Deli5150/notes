import type { ServiceId } from '../types'
import { github } from './github'
import { gtasks } from './gtasks'
import { jira } from './jira'
import { linear } from './linear'
import { todoist } from './todoist'
import type { Service } from './types'

// The connected services, in the order Settings shows them.

export const SERVICES: Service[] = [github, todoist, linear, jira, gtasks]

export const serviceById = (id: ServiceId): Service => SERVICES.find((s) => s.id === id) ?? github
