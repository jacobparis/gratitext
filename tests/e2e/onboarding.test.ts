import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { prisma } from '#app/utils/db.server.ts'
import { waitForText } from '#tests/mocks/utils.ts'
import { test as base, createUser, expect } from '#tests/playwright-utils.ts'

const URL_REGEX = /(?<url>https?:\/\/[^\s$.?#].[^\s]*)/
const CODE_REGEX = /code: (?<code>[\d\w]+)/
function extractUrl(text: string) {
	const match = text.match(URL_REGEX)
	return match?.groups?.url
}

const test = base.extend<{
	getOnboardingData(): {
		username: string
		name: string
		phoneNumber: string
		password: string
	}
}>({
	getOnboardingData: async ({}, use) => {
		const userData = createUser()
		await use(() => {
			const onboardingData = {
				...userData,
				password: faker.internet.password(),
			}
			return onboardingData
		})
		await prisma.user.deleteMany({ where: { username: userData.username } })
	},
})

test('onboarding with link', async ({ page, getOnboardingData }) => {
	const onboardingData = getOnboardingData()

	await page.goto('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)

	const createAccountLink = page.getByRole('link', {
		name: /create an account/i,
	})
	await createAccountLink.click()

	await expect(page).toHaveURL(`/signup`)

	const phoneNumberTextbox = page.getByRole('textbox', {
		name: /phone number/i,
	})
	await phoneNumberTextbox.click()
	await phoneNumberTextbox.fill(onboardingData.phoneNumber)

	await page.getByRole('button', { name: /submit/i }).click()
	await expect(
		page.getByRole('button', { name: /submit/i, disabled: true }),
	).toBeVisible()
	await expect(page.getByText(/check your texts/i)).toBeVisible()

	const sourceNumber = await prisma.sourceNumber.findFirstOrThrow({
		select: { phoneNumber: true },
	})
	const textMessage = await waitForText(onboardingData.phoneNumber)
	expect(textMessage.To).toBe(onboardingData.phoneNumber.toLowerCase())
	expect(textMessage.From).toBe(sourceNumber.phoneNumber)
	expect(textMessage.Body).toMatch(/welcome/i)
	const onboardingUrl = extractUrl(textMessage.Body)
	invariant(onboardingUrl, 'Onboarding URL not found')
	await page.goto(onboardingUrl)

	await expect(page).toHaveURL(/\/verify/)

	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL(`/onboarding`)
	await page
		.getByRole('textbox', { name: /^username/i })
		.fill(onboardingData.username)

	await page.getByRole('textbox', { name: /^name/i }).fill(onboardingData.name)

	await page.getByLabel(/^password/i).fill(onboardingData.password)

	await page.getByLabel(/^confirm password/i).fill(onboardingData.password)

	await page.getByLabel(/terms/i).check()

	await page.getByLabel(/remember me/i).check()

	await page.getByRole('button', { name: /Create an account/i }).click()

	await expect(page).toHaveURL(`/`)

	await page.getByRole('link', { name: onboardingData.name }).click()
	await page.getByRole('menuitem', { name: /profile/i }).click()

	await expect(page).toHaveURL(`/users/${onboardingData.username}`)

	await page.getByRole('link', { name: onboardingData.name }).click()
	await page.getByRole('menuitem', { name: /logout/i }).click()
	await expect(page).toHaveURL(`/`)
})

test('onboarding with a short code', async ({ page, getOnboardingData }) => {
	const onboardingData = getOnboardingData()

	await page.goto('/signup')

	const phoneNumberTextbox = page.getByRole('textbox', {
		name: /phone number/i,
	})
	await phoneNumberTextbox.click()
	await phoneNumberTextbox.fill(onboardingData.phoneNumber)

	await page.getByRole('button', { name: /submit/i }).click()
	await expect(
		page.getByRole('button', { name: /submit/i, disabled: true }),
	).toBeVisible()
	await expect(page.getByText(/Check your texts/i)).toBeVisible()

	const sourceNumber = await prisma.sourceNumber.findFirstOrThrow({
		select: { phoneNumber: true },
	})
	const textMessage = await waitForText(onboardingData.phoneNumber, {
		errorMessage: 'Onboarding code not found',
	})
	expect(textMessage.To).toBe(onboardingData.phoneNumber)
	expect(textMessage.From).toBe(sourceNumber.phoneNumber)
	expect(textMessage.Body).toMatch(/welcome/i)
	const codeMatch = textMessage.Body.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()

	await expect(page).toHaveURL(`/onboarding`)
})

test('login as existing user', async ({ page, insertNewUser }) => {
	const password = faker.internet.password()
	const user = await insertNewUser({ password })
	invariant(user.name, 'User name not found')
	await page.goto('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/`)

	await expect(page.getByRole('link', { name: user.name })).toBeVisible()
})

test('reset password with a link', async ({ page, insertNewUser }) => {
	const originalPassword = faker.internet.password()
	const user = await insertNewUser({ password: originalPassword })
	invariant(user.name, 'User name not found')
	await page.goto('/login')

	await page.getByRole('link', { name: /forgot password/i }).click()
	await expect(page).toHaveURL('/forgot-password')

	await expect(
		page.getByRole('heading', { name: /forgot password/i }),
	).toBeVisible()
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByRole('button', { name: /recover password/i }).click()
	await expect(
		page.getByRole('button', { name: /recover password/i, disabled: true }),
	).toBeVisible()
	await expect(page.getByText(/check your texts/i)).toBeVisible()

	const sourceNumber = await prisma.sourceNumber.findFirstOrThrow({
		select: { phoneNumber: true },
	})
	const textMessage = await waitForText(user.phoneNumber)
	expect(textMessage.Body).toMatch(/password reset/i)
	expect(textMessage.To).toBe(user.phoneNumber)
	expect(textMessage.From).toBe(sourceNumber.phoneNumber)
	const resetPasswordUrl = extractUrl(textMessage.Body)
	invariant(resetPasswordUrl, 'Reset password URL not found')
	await page.goto(resetPasswordUrl)

	await expect(page).toHaveURL(/\/verify/)

	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL(`/reset-password`)
	const newPassword = faker.internet.password()
	await page.getByLabel(/^new password$/i).fill(newPassword)
	await page.getByLabel(/^confirm password$/i).fill(newPassword)

	await page.getByRole('button', { name: /reset password/i }).click()
	await expect(
		page.getByRole('button', { name: /reset password/i, disabled: true }),
	).toBeVisible()

	await expect(page).toHaveURL('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(originalPassword)
	await page.getByRole('button', { name: /log in/i }).click()

	await expect(page.getByText(/invalid username or password/i)).toBeVisible()

	await page.getByLabel(/^password$/i).fill(newPassword)
	await page.getByRole('button', { name: /log in/i }).click()

	await expect(page).toHaveURL(`/`)

	await expect(page.getByRole('link', { name: user.name })).toBeVisible()
})

test('reset password with a short code', async ({ page, insertNewUser }) => {
	const user = await insertNewUser()
	await page.goto('/login')

	await page.getByRole('link', { name: /forgot password/i }).click()
	await expect(page).toHaveURL('/forgot-password')

	await expect(
		page.getByRole('heading', { name: /forgot password/i }),
	).toBeVisible()
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByRole('button', { name: /recover password/i }).click()
	await expect(
		page.getByRole('button', { name: /recover password/i, disabled: true }),
	).toBeVisible()
	await expect(page.getByText(/Check your texts/i)).toBeVisible()

	const sourceNumber = await prisma.sourceNumber.findFirstOrThrow({
		select: { phoneNumber: true },
	})
	const textMessage = await waitForText(user.phoneNumber)
	expect(textMessage.Body).toMatch(/password reset/i)
	expect(textMessage.To).toBe(user.phoneNumber)
	expect(textMessage.From).toBe(sourceNumber.phoneNumber)
	const codeMatch = textMessage.Body.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Reset Password code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()

	await expect(page).toHaveURL(`/reset-password`)
})

test('completes onboarding after GitHub OAuth given valid user details', async ({
	page,
	getOnboardingData,
}) => {
	const ghUser = getOnboardingData()

	await page.goto('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)

	await page.getByRole('button', { name: /signup with github/i }).click()

	await expect(page).toHaveURL(/\/onboarding\/github/)
	await expect(
		page.getByText(new RegExp(`welcome aboard ${ghUser.primaryEmail}`, 'i')),
	).toBeVisible()

	// fields are pre-populated for the user, so we only need to accept
	// terms of service and hit the 'crete an account' button
	const usernameInput = page.getByRole('textbox', { name: /username/i })
	await expect(usernameInput).toHaveValue(
		normalizeUsername(ghUser.profile.login),
	)
	await expect(page.getByRole('textbox', { name: /^name/i })).toHaveValue(
		ghUser.profile.name,
	)
	const createAccountButton = page.getByRole('button', {
		name: /create an account/i,
	})

	await page.getByLabel(/terms/i).check()
	await page.getByLabel(/remember me/i).check()
	await createAccountButton.click()

	await expect(page).toHaveURL(`/`)
})

test('logs user in after GitHub OAuth if they are already registered', async ({
	page,
	insertNewUser,
}) => {
	const ghUser = await insertNewUser()

	await page.goto('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)

	await page.getByRole('button', { name: /signup with github/i }).click()

	await expect(page).toHaveURL(`/`)
	await expect(
		page.getByText(
			new RegExp(
				`your "${ghUser!.profile.login}" github account has been connected`,
				'i',
			),
		),
	).toBeVisible()

	await expect(page.getByRole('link', { name: ghUser.name })).toBeVisible()
})

test('shows help texts on entering invalid details on onboarding page after GitHub OAuth', async ({
	page,
	getOnboardingData,
}) => {
	const ghUser = getOnboardingData()

	await page.goto('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)

	await page.getByRole('button', { name: /signup with github/i }).click()

	await expect(page).toHaveURL(/\/onboarding\/github/)
	await expect(
		page.getByText(new RegExp(`welcome aboard ${ghUser.primaryEmail}`, 'i')),
	).toBeVisible()

	const usernameInput = page.getByRole('textbox', { name: /username/i })
	await usernameInput.clear()

	const createAccountButton = page.getByRole('button', {
		name: /create an account/i,
	})
	await expect(createAccountButton.getByRole('status')).not.toBeVisible()
	await expect(createAccountButton.getByText('error')).not.toBeAttached()

	// invalid chars in username
	await usernameInput.fill('U$er_name') // $ is invalid char, see app/utils/user-validation.ts.
	await createAccountButton.click()

	await expect(createAccountButton.getByRole('status')).toBeVisible()
	await expect(createAccountButton.getByText('error')).toBeAttached()
	await expect(
		page.getByText(
			/username can only include letters, numbers, and underscores/i,
		),
	).toBeVisible()
})
