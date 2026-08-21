import { Page } from '@playwright/test';

export class PropertyPage {
    constructor(private page: Page) {}

    async createProperty() {
        await this.page.getByRole('button', { name: /create property/i }).click();

        await this.page.locator("//input[@name='title']").fill("ganesh");

        await this.page.locator("//div[contains(text(),'Select category')]").click();
        await this.page.getByRole('option', { name: /land/i }).click();

        await this.page.locator("//div[contains(text(),'Select property group')]").click();
        await this.page.getByRole('option', { name: /residential buildings/i }).click();

        await this.page.locator("//div[contains(text(),'Select property type')]").click();
        await this.page.getByRole('option', { name: /villa/i }).click();

        await this.page.locator("//input[@placeholder='Enter property size']").fill('2000');

        await this.page.getByRole('button', { name: /back to properties/i }).click();
    }
}