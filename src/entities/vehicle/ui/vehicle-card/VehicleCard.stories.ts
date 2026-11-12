import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { vehicleFixture } from '@shared/testing'
import VehicleCard from './VehicleCard.vue'

const meta = { title: 'entities/vehicle/VehicleCard', component: VehicleCard } satisfies Meta<typeof VehicleCard>

export default meta
type Story = StoryObj<typeof meta>

export const Warning: Story = { args: { vehicle: vehicleFixture } }
export const Nominal: Story = { args: { vehicle: { ...vehicleFixture, health: 'nominal', issues: [] } } }
