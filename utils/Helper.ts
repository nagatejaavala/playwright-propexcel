import { Page, expect } from '@playwright/test';

export class LoginPage {
    constructor(private page: Page) {}

    async login(org: string, email: string, password: string) {
        await this.page.goto('https://test.propexcel.com/login');

        await this.page.locator('input[placeholder*="organization"]').fill(org);
        await this.page.locator('input[type="email"]').fill(email);
        await this.page.locator('input[type="password"]').fill(password);
        await this.page.getByRole('button', { name: /sign in/i }).click();

        await this.page.waitForURL(/property/);
        await expect(
            this.page.getByRole('heading', { name: /properties/i }).first()
        ).toBeVisible();
    }
}