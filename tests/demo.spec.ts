import { test, expect, Locator } from '@playwright/test';
import { chromium } from '@playwright/test';

async function clickIfVisible(locator: Locator): Promise<boolean> {
    if (await locator.count() === 0) return false;
    await expect(locator).toBeVisible({ timeout: 60000 });
    await expect(locator).toBeEnabled({ timeout: 60000 });
    await locator.click();
    return true;
}

async function fillIfVisible(locator: Locator, value: string): Promise<boolean> {
    if (await locator.count() === 0) return false;
    await expect(locator).toBeVisible({ timeout: 60000 });
    await locator.fill(value);
    return true;
}

test.setTimeout(120000);

test('Propexcel Automation', async ({ browser }) => {
    // Create browser context
    const context = await browser.newContext({
        permissions: [] // Blocks browser permission popups
    });

    const page = await context.newPage();

    // Open Login Page
    await page.goto('https://test.propexcel.com/login');

    // Login
    await page.locator('input[placeholder*="organization"]').fill('honey-well');
    await page.locator('input[type="email"]').fill('anil.ck@propexcel.com');
    await page.locator('input[type="password"]').fill('Asdf@1234');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait until login completes and property page is visible
    await page.waitForURL(/property/, { timeout: 60000 });
    await expect(page.getByRole('heading', { name: /properties/i }).first()).toBeVisible({ timeout: 60000 });

   

    // Wait for Create Property button
    let createButton = page.getByRole('button', { name: /^(?:\+ )?create property$/i }).first();
    if (await createButton.count() === 0) {
        createButton = page.locator('button:has-text("Create Property")').first();
    }
    if (await createButton.count() === 0) {
        createButton = page.locator('text=/Create Property/i').first();
    }
    await expect(createButton).toBeVisible({ timeout: 60000 });

    // Click Create Property
    await createButton.click();
    await page.waitForTimeout(2000);

    // Wait for the create property form and fill fields
    const titleInput = page.locator('xpath=//input[@name="title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 60000 });
    await titleInput.click();
    await titleInput.fill('rajesh');

    // Select Category
    const categoryDropdown = page.locator("xpath=//div[contains(text(),'Select category')]").first();
    await expect(categoryDropdown).toBeVisible({ timeout: 60000 });
    await categoryDropdown.click();
    await page.getByRole('option', { name: /land/i }).click();

    // Select Property Group
    const groupDropdown = page.locator("xpath=//div[contains(text(),'Select property group')]").first();
    await expect(groupDropdown).toBeVisible({ timeout: 60000 });
    await groupDropdown.click();
    await page.getByRole('option', { name: /residential buildings/i }).click();

    // Select Property Type
    const typeDropdown = page.locator("xpath=//div[contains(text(),'Select property type')]").first();
    await expect(typeDropdown).toBeVisible({ timeout: 60000 });
    await typeDropdown.click();
    await page.getByRole('option', { name: /villa/i }).click();

    // Fill Size
    const sizeInput = page.locator("xpath=//input[@placeholder='Enter property size']").first();
    await expect(sizeInput).toBeVisible({ timeout: 60000 });
    await sizeInput.fill('2000');

    await page.waitForTimeout(3000); // Wait for 3 seconds

    // Click 'Back to Properties' (provided XPath)
    const backBtn = page.locator("xpath=//button[@class='inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent h-10 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 gap-2']");
    if (await backBtn.count() > 0) {
        await expect(backBtn).toBeVisible({ timeout: 60000 });
        await backBtn.click();
        await page.waitForTimeout(2000);
    } else {
        // Fallback: click link or button text
        const backFallback = page.getByRole('link', { name: /Back to Properties/i }).first();
        if (await backFallback.count() > 0) {
            await backFallback.click();
            await page.waitForTimeout(2000);
        }
    }

    // Click the CRM icon using the provided JS path; fallback to XPath click
    const jsClicked = await page.evaluate(() => {
        const el = document.querySelector("body > div:nth-child(24) > header:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(6) > div:nth-child(1) > svg:nth-child(1) > path:nth-child(1)");
        if (!el) return false;
        // Prefer clicking the parent SVG if available
        const svg = el.closest('svg');
        try {
            if (svg) { (svg as unknown as HTMLElement).click(); return true; }
            (el as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        } catch (e) {
            return false;
        }
    });

    if (!jsClicked) {
        const crmButton = page.locator("xpath=//body/div[@class='app-container-bg min-h-screen']/header/div/div[@class='flex items-center gap-2']/div/div[6]/div[1]//*[name()='svg']//*[name()='path' and contains(@d,'M18 18.72a')]");
        await expect(crmButton).toBeVisible({ timeout: 60000 });
        await crmButton.click();
    }
    await page.waitForTimeout(3000);

    // Click 'Leads' in the left menu using provided XPath
    const leadsItem = page.locator("xpath=//span[normalize-space()='Leads']").first();
    if (await leadsItem.count() > 0) {
        await expect(leadsItem).toBeVisible({ timeout: 60000 });
        await leadsItem.click();
        await page.waitForTimeout(3000);
    } else {
        const leadsFallback = page.getByRole('link', { name: /Leads/i }).first();
        if (await leadsFallback.count() > 0) {
            await leadsFallback.click();
            await page.waitForTimeout(3000);
        }
    }

    // Click the '+ Create Lead' button
    const createLeadBtn = page.locator("xpath=//button[normalize-space()='+ Create Lead']").first();
    if (await createLeadBtn.count() > 0) {
        await expect(createLeadBtn).toBeVisible({ timeout: 60000 });
        await createLeadBtn.click();
        await page.waitForTimeout(2000);
    } else {
        const createLeadFallback = page.getByRole('button', { name: '+ Create Lead' }).first();
        if (await createLeadFallback.count() > 0) {
            await createLeadFallback.click();
            await page.waitForTimeout(2000);
        }
    }

    // Enter 'Venkat' into the Leads search box (relative XPath)
    const leadsSearch = page.locator("xpath=//div[contains(@class, 'relative')]/input[contains(@class, 'w-full')] ").first();
    if (await leadsSearch.count() > 0) {
        await expect(leadsSearch).toBeVisible({ timeout: 60000 });
        await leadsSearch.fill('rajesh');
        await leadsSearch.press('Enter').catch(() => {});
        await page.waitForTimeout(2000);
    } else {
        const searchFallback = page.locator('input[placeholder*="Search"], input[type="search"]').first();
        if (await searchFallback.count() > 0) {
            await expect(searchFallback).toBeVisible({ timeout: 60000 });
            await searchFallback.fill('rajesh');
            await searchFallback.press('Enter').catch(() => {});
            await page.waitForTimeout(2000);
        }
    }

    // Click 'Create New lead' (by class-based XPath provided)
    const createNewLead = page.locator("xpath=//div[contains(@class, 'hover:bg-blue-100/60') and contains(@class, 'text-blue-600')]").first();
    if (await createNewLead.count() > 0) {
        await expect(createNewLead).toBeVisible({ timeout: 60000 });
        await createNewLead.click();
        await page.waitForTimeout(3000);
    } else {
        // Fallback: try button with text
        const createLeadFallback = page.getByRole('button', { name: /create lead|\+ create lead/i }).first();
        if (await createLeadFallback.count() > 0) {
            await expect(createLeadFallback).toBeVisible({ timeout: 60000 });
            await createLeadFallback.click();
            await page.waitForTimeout(3000);
        }
    }

    // Fill Lead form fields
    // Name
    const leadName = page.locator("css=div#radix-_r_9u_ > div > div > div:nth-of-type(2) > div > input").first();
    if (await leadName.count() > 0) {
        await expect(leadName).toBeVisible({ timeout: 60000 });
        await leadName.fill('rajesh');
    } else {
        const nameFallback = page.getByLabel(/name|full name/i).first();
        if (await nameFallback.count() > 0) await nameFallback.fill('rajesh').catch(() => {});
    }
    await page.waitForTimeout(2000); // Wait for 5 seconds

    await page.locator('input[type="email"]').fill('rajesh@propexcel.com');
    await page.waitForTimeout(2000); // Wait for 5 seconds


    await page.locator('input[type="tel"]').fill('9876543210');

     

await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
});

await page.waitForTimeout(2000); // Wait 2 seconds

    // Click the Create button using JS path 'Create'
    const createClicked = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent?.trim() === 'Create');
        if (!button) return false;
        try { (button as HTMLElement).click(); return true; } catch { return false; }
    }).catch(() => false);
    if (!createClicked) {
        const createButton = page.getByRole('button', { name: /^Create$/i }).first();
        if (await createButton.count() > 0) {
            await expect(createButton).toBeVisible({ timeout: 60000 });
            await createButton.click();
        }
    }
    await page.waitForTimeout(6000);

    // Convert the newly created lead into a deal
    let convertedDealName = 'rajesh Deal';
    const convertDealButton = page.getByRole('button', { name: /convert deal|convert/i }).first();
    if (await convertDealButton.count() > 0) {
        await clickIfVisible(convertDealButton);
    } else {
        const convertDealFallback = page.locator("xpath=//button[contains(normalize-space(.), 'Convert Deal') or contains(normalize-space(.), 'Convert')]").first();
        await clickIfVisible(convertDealFallback);
    }
    await page.waitForTimeout(5000);

    // Fill mandatory deal fields
    await fillIfVisible(page.getByLabel(/deal name|name/i).first(), convertedDealName);
    await fillIfVisible(page.getByLabel(/amount|value|budget/i).first(), '500000');
    await fillIfVisible(page.getByLabel(/close date|expected close/i).first(), '2026-12-31');
    const stageDropdown = page.getByLabel(/stage|pipeline|deal stage/i).first();
    if (await stageDropdown.count() > 0) {
        await stageDropdown.click().catch(() => {});
        await page.getByRole('option', { name: /qual|proposal|negoti|won|lost/i }).first().click().catch(() => {});
    }
    await page.waitForTimeout(2000);

    // Click the dropdown
await page.locator("//div[text()='Select payment type...']").click();

// Click the Cash option
await page.locator("//div[text()='Cash']").click();

    const saveDealButton = page.getByRole('button', { name: /save deal|convert|save/i }).first();
    if (await saveDealButton.count() > 0) {
        await expect(saveDealButton).toBeEnabled({ timeout: 60000 });
        await clickIfVisible(saveDealButton);
    } else {
        const saveDealFallback = page.locator("xpath=//button[contains(normalize-space(.), 'Save') or contains(normalize-space(.), 'Convert')]   ").first();
        if (await saveDealFallback.count() > 0) {
            await expect(saveDealFallback).toBeEnabled({ timeout: 60000 });
            await clickIfVisible(saveDealFallback);
        }
    }
    await page.waitForTimeout(8000);

    // Navigate to Deals page and open the converted deal
    const dealsMenu = page.locator("xpath=//span[normalize-space()='Deals']").first();
    if (await dealsMenu.count() > 0) {
        await clickIfVisible(dealsMenu);
    } else {
        await clickIfVisible(page.getByRole('link', { name: /deals/i }).first());
    }
    await page.waitForTimeout(3000);

    const dealRow = page.locator(`xpath=//div[contains(normalize-space(.), '${convertedDealName}')]`).first();
    if (await dealRow.count() > 0) {
        await clickIfVisible(dealRow);
    } else {
        const dealsSearchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
        if (await dealsSearchInput.count() > 0) {
            await fillIfVisible(dealsSearchInput, 'rajesh');
            await dealsSearchInput.press('Enter').catch(() => {});
            await page.waitForTimeout(3000);

            const searchResult = page.locator("xpath=(//div[contains(normalize-space(.), 'rajesh')])[1]").first();
            if (await searchResult.count() > 0) {
                await clickIfVisible(searchResult);
            } else {
                const textResult = page.getByText(/rajesh/i).first();
                if (await textResult.count() > 0) {
                    await clickIfVisible(textResult);
                }
            }
        }
    }
    await page.waitForTimeout(3000);

    // Select deal using provided JS path
    const jsDealSelected = await page.evaluate(() => {
        const dealElement = document.querySelector("h4[class='font-semibold text-gray-900 dark:text-white line-clamp-2']");
        if (!dealElement) return false;
        (dealElement as HTMLElement).click();
        return true;
    }).catch(() => false);
    if (!jsDealSelected) {
        const dealHeading = page.locator("h4.font-semibold.text-gray-900.dark\\:text-white.line-clamp-2").first();
        if (await dealHeading.count() > 0) {
            await clickIfVisible(dealHeading);
        }
    }
    await page.waitForTimeout(8000);

    // Deal details: Add Property flow
    const addPropertyDetailButton = page.getByRole('button', { name: /add property/i }).first();
    if (await addPropertyDetailButton.count() > 0) {
        await clickIfVisible(addPropertyDetailButton);
    } else {
        const addPropertyDetailFallback = page.locator("xpath=//button[contains(normalize-space(.), 'Add Property') or contains(normalize-space(.), 'Add property')]").first();
        await clickIfVisible(addPropertyDetailFallback);
    }
    await page.waitForTimeout(4000);

    const vacantTab = page.locator("xpath=//button[normalize-space()='Vacant' or contains(normalize-space(.), 'Vacant')]").first();
    if (await vacantTab.count() > 0) {
        try {
            await expect(vacantTab).toBeVisible({ timeout: 15000 });
            await expect(vacantTab).toBeEnabled({ timeout: 15000 });
            await vacantTab.click();
        } catch (e) {
            // fallback: try a JS click if the button remains disabled/unstable
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().toLowerCase() === 'vacant' || (b.textContent||'').trim().toLowerCase().includes('vacant'));
                if (btn) (btn as HTMLElement).click();
            }).catch(() => {});
        }
    } else {
        const vacantFilter = page.getByText(/vacant/i).first();
        if (await vacantFilter.count() > 0) {
            try {
                await expect(vacantFilter).toBeEnabled({ timeout: 10000 });
                await vacantFilter.click();
            } catch {
                await page.evaluate(() => {
                    const el = Array.from(document.querySelectorAll('button,div,span')).find(x => (x.textContent||'').trim().toLowerCase().includes('vacant'));
                    if (el) (el as HTMLElement).click();
                }).catch(() => {});
            }
        }
    }
    await page.waitForTimeout(3000);

    await page.locator('//input[@placeholder="Search..."]').fill('rajesh');

    const vacantPropertyRow = page.locator("xpath=(//div[contains(normalize-space(.), 'Vacant')])[1]").first();
    if (await vacantPropertyRow.count() > 0) {
       await clickIfVisible(vacantPropertyRow);
    }
        await page.waitForTimeout(3000);

//const element = page.locator('div.relative.group.cursor-pointer.overflow-hidden.rounded-lg.border-2');
       // await page.waitForTimeout(6000);

    const addSelectedPropertyButton = page.getByRole('button', { name: /add property|select property|assign property/i }).first();
    if (await addSelectedPropertyButton.count() > 0) {
        await clickIfVisible(addSelectedPropertyButton);
    } else {
        const addSelectedPropertyFallback = page.locator("xpath=//button[contains(normalize-space(.), 'Add Property') or contains(normalize-space(.), 'Add')]").first();
        await clickIfVisible(addSelectedPropertyFallback);
    }
    await page.waitForTimeout(3000);
    // Enter rent amount using provided JS path, with fallback locator

    // Rent input locator
const rentInputLocator = page.locator(
    'input[placeholder*="Rent"], input[name*="rent"], input[type="number"]'
).first();

// Try using the JS path
await page.evaluate(() => {
    const input = document.querySelector(
        "body > div:nth-child(24) > main:nth-child(2) > div:nth-child(1) > main:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(3) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > input:nth-child(1)"
    ) as HTMLInputElement | null;

    if (input) {
        input.click();     // Click the input
        input.focus();     // Focus the input
    }
}).catch(() => {});

// Fallback using Playwright locator
if (await rentInputLocator.count() > 0) {
    await rentInputLocator.click();          // Click the input
    await rentInputLocator.clear();          // Optional: clear existing value
    await rentInputLocator.fill('500');     // Enter value
    await rentInputLocator.press('Enter');   // Optional: Press Enter
}
    // Wait for the rent input to be stable
    await page.waitForTimeout(3000);

    // Click Save using provided JS path, with fallback to visible Save button
    const jsSaveClicked = await page.evaluate(() => {
        try {
            const btn = document.querySelector("button[class='inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [background:var(--button-primary-bg,hsl(var(--primary)))] text-[var(--button-primary-text,hsl(var(--primary-foreground)))] hover:[background:var(--button-primary-hover-bg,var(--button-primary-bg,hsl(var(--primary)))))] border border-[var(--button-primary-border,transparent)] h-9 rounded-md px-3 w-full']");
            if (!btn) return false;
            (btn as HTMLElement).click();
            return true;
        } catch (e) {
            return false;
        }
    }).catch(() => false);
    if (!jsSaveClicked) {
        const saveBtn = page.getByRole('button', { name: /save|submit|add property/i }).first();
        if (await saveBtn.count() > 0) {
            await clickIfVisible(saveBtn);
        }
    }
    await page.waitForTimeout(3000);

    


    // Now wait for the Approve button to appear and click it (use visible locator only)
    const approveBtn = page.getByRole('button', { name: /approve deal|approve/i }).first();
    if (await approveBtn.count() > 0) {
        await expect(approveBtn).toBeVisible({ timeout: 15000 });
        await approveBtn.click();
    } else {
        // try a JS click specifically searching for 'approve' text
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim().toLowerCase().includes('approve'));
            if (btn) (btn as HTMLElement).click();
        }).catch(() => {});
    }
    await page.waitForTimeout(6000);

    
    // Click 'Create Contract' (top-right)
    const createContractBtn = page.getByRole('button', { name: /create contract|create contract/i }).first();
    if (await createContractBtn.count() > 0) {
        await clickIfVisible(createContractBtn);
    } else {
        const createContractFallback = page.locator("xpath=//button[contains(normalize-space(.), 'Create Contract') or contains(normalize-space(.), 'Create contract')]").first();
        await clickIfVisible(createContractFallback);
        }

const viewContractButton = page.locator(
  "a.flex-shrink-0 button.inline-flex.items-center.justify-center.h-9.rounded-md"
).first();

await viewContractButton.waitFor({
    state: 'visible',
    timeout: 60000
});

await viewContractButton.click(); 
    await page.waitForLoadState('load');


    //await page.waitForLoadState('load');

   await page.locator("//button[normalize-space()='Approve Contract']").click();

   //await page.waitForTimeout(3000);

    await page.waitForLoadState('load');

    //naviagte to invoice 
    await page.locator("//span[normalize-space()='Invoices']").click();
    await page.waitForLoadState('load');

    await page.getByText('Create Invoice', { exact: true }).click();

    await page.waitForLoadState('load');


    // ===============================
// Step 1: Click on Contact/Tenant Combo Box
// ===============================

const contactTenant = page.getByText(
    'Search and select contact or tenant',
    { exact: true }
);

await contactTenant.waitFor({
    state: 'visible',
    timeout: 90000
});

await contactTenant.click();


// ===============================
// Step 2: Enter Tenant Name in Search Box
// ===============================

const searchBox = page.locator("input[placeholder='Search...']");

await searchBox.waitFor({
    state: 'visible',
    timeout: 90000
});

await searchBox.click();
await searchBox.fill("sathish");

//await page.waitForTimeout(1000); // Wait for 2 seconds
// ===============================
// Step 3: Select the Tenant
// ===============================

const tenantOption = page.getByText(
    "sathish (Tenant)",
    { exact: true }
);

await tenantOption.waitFor({
    state: 'visible',
    timeout: 90000
});

await tenantOption.click();

// Wait until invoice details are loaded
//await page.waitForLoadState('networkidle');

const button = page.locator(
  "button.h-9.rounded-md.px-3.w-full.sm\\:w-auto"
);

await button.waitFor({
    state: "visible",
    timeout: 90000
});

await button.click();

const amountInput = page.getByPlaceholder('0.00');

await amountInput.waitFor({
    state: 'visible',
    timeout: 90000
});

await amountInput.click();
await amountInput.fill('500');
await amountInput.press('Enter');

await page.getByRole('button', { name: 'Save' }).click();

await page.getByRole('button', { name: 'Submit' }).click();

    await page.waitForLoadState('load');


 const receivePaymentButton = page.getByRole('button', {
    name: 'Receive Payment'
});

await receivePaymentButton.waitFor({
    state: 'visible',
    timeout: 90000
});

await receivePaymentButton.click();

await page.waitForTimeout(2000);

    await page.waitForLoadState('load');


// ===============================
// Step 1: Click the "Select account..." combo box
// ===============================

const accountDropdown = page.getByRole('combobox', {
    name: 'Select account...'
});

await accountDropdown.waitFor({
    state: 'visible',
    timeout: 60000
});

await accountDropdown.click();


// ===============================
// Step 2: Search for account "1000"
// ===============================

const accountSearch = page.getByPlaceholder('Search...');

await accountSearch.waitFor({
    state: 'visible',
    timeout: 60000
});

await accountSearch.fill('1000');


// ===============================
// Step 3: Select the account
// ===============================

const accountOption = page.getByText(
    '1000 - Cash (Asset / Current Asset)',
    { exact: true }
);

await accountOption.waitFor({
    state: 'visible',
    timeout: 60000
});

await accountOption.click();
    await page.waitForLoadState('load');


const savePaymentButton = page.getByRole('button', {
    name: 'Save Payment'
});

await savePaymentButton.waitFor({
    state: 'visible',
    timeout: 60000
});

await savePaymentButton.click();


      // Finalize test: close context instead of pausing or long static waits
    await context.close();
});


