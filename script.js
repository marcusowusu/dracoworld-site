const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealElements = document.querySelectorAll(".reveal");
const openWhatsApp = (message, statusElement) => {
  const whatsappUrl = new URL("https://wa.me/233506731027");
  whatsappUrl.searchParams.set("text", message);

  const whatsappWindow = window.open(whatsappUrl.toString(), "_blank");
  if (whatsappWindow) {
    whatsappWindow.opener = null;
    statusElement.textContent = "WhatsApp opened with your message. Press Send to finish.";
    return;
  }

  statusElement.textContent = "A new tab was blocked. Opening WhatsApp in this tab.";
  window.location.href = whatsappUrl.toString();
};

if (!reduceMotion && "IntersectionObserver" in window && revealElements.length > 0) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  revealElements.forEach((element) => revealObserver.observe(element));
  document.body.classList.add("motion-ready");
}

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector("#main-menu");

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    mainNav.classList.toggle("is-open", isOpen);
  });

  mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open menu");
      mainNav.classList.remove("is-open");
    });
  });
}

const searchToggle = document.querySelector(".search-toggle");
const siteSearch = document.querySelector("#site-search");
const searchInput = document.querySelector("#site-search-input");
const searchStatus = document.querySelector("#search-status");
const productCards = document.querySelectorAll(".product-card");

if (searchToggle && siteSearch && searchInput && searchStatus) {
  const closeSearch = () => {
    siteSearch.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    searchInput.value = "";
    searchStatus.textContent = "";
    productCards.forEach((card) => {
      card.hidden = false;
    });
  };

  searchToggle.addEventListener("click", () => {
    const isOpen = searchToggle.getAttribute("aria-expanded") !== "true";
    searchToggle.setAttribute("aria-expanded", String(isOpen));
    siteSearch.hidden = !isOpen;

    if (isOpen) {
      searchInput.focus();
    } else {
      closeSearch();
    }
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    let matches = 0;

    productCards.forEach((card) => {
      const productName = card.querySelector("h3")?.textContent.toLocaleLowerCase() ?? "";
      const isMatch = productName.includes(query);
      card.hidden = !isMatch;
      matches += Number(isMatch);
    });

    searchStatus.textContent = query
      ? matches === 1 ? "1 product found." : `${matches} products found.`
      : "";
  });

  siteSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    document.querySelector("#collection")?.scrollIntoView({ behavior: "smooth" });
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSearch();
      searchToggle.focus();
    }
  });
}

const newsletterForm = document.querySelector("#newsletter-form");
const newsletterEmail = document.querySelector("#newsletter-email");
const newsletterStatus = document.querySelector("#newsletter-status");

if (newsletterForm && newsletterEmail && newsletterStatus) {
  newsletterForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!newsletterForm.reportValidity()) {
      return;
    }

    const subject = encodeURIComponent("DracoWorld updates");
    const body = encodeURIComponent(`Please contact me about upcoming DracoWorld drops.\n\nEmail: ${newsletterEmail.value.trim()}`);
    newsletterStatus.textContent = "Opening your email app to send your request.";
    window.location.href = `mailto:dracoworldorg12@gmail.com?subject=${subject}&body=${body}`;
  });
}

const cartItemsElement = document.querySelector("#cart-items");
const cartItemCount = document.querySelector("#cart-item-count");
const cartTotal = document.querySelector("#cart-total");
const cartCount = document.querySelector(".cart-count");
const cartLink = document.querySelector(".cart-link");
const cartCheckout = document.querySelector("#cart-checkout");
const cartStatus = document.querySelector("#cart-status");

if (cartItemsElement && cartItemCount && cartTotal && cartCount && cartLink && cartCheckout && cartStatus) {
  const cart = new Map();
  const formatPrice = (amount) => `GH₵${amount.toLocaleString("en-GH")}`;

  const makeCartControl = (label, action, productId, text, className = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cart-control ${className}`.trim();
    button.dataset.cartAction = action;
    button.dataset.productId = productId;
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
  };

  const renderCart = () => {
    cartItemsElement.replaceChildren();
    let quantityTotal = 0;
    let priceTotal = 0;

    cart.forEach((item, productId) => {
      quantityTotal += item.quantity;
      priceTotal += item.price * item.quantity;

      const row = document.createElement("li");
      row.className = "cart-item";
      const details = document.createElement("div");
      const name = document.createElement("h3");
      name.className = "cart-item-name";
      name.textContent = item.name;
      const price = document.createElement("p");
      price.className = "cart-item-price";
      price.textContent = `${formatPrice(item.price)} each · ${formatPrice(item.price * item.quantity)} total`;
      details.append(name, price);

      const controls = document.createElement("div");
      controls.className = "cart-item-controls";
      controls.append(
        makeCartControl(`Decrease quantity of ${item.name}`, "decrease", productId, "−"),
      );
      const quantity = document.createElement("span");
      quantity.className = "cart-quantity";
      quantity.textContent = String(item.quantity);
      quantity.setAttribute("aria-label", `Quantity: ${item.quantity}`);
      controls.append(
        quantity,
        makeCartControl(`Increase quantity of ${item.name}`, "increase", productId, "+"),
        makeCartControl(`Remove ${item.name} from cart`, "remove", productId, "Remove", "cart-remove"),
      );
      row.append(details, controls);
      cartItemsElement.append(row);
    });

    if (cart.size === 0) {
      const emptyMessage = document.createElement("li");
      emptyMessage.className = "cart-empty";
      emptyMessage.textContent = "Your cart is empty. Choose an attire above to get started.";
      cartItemsElement.append(emptyMessage);
    }

    cartCount.textContent = String(quantityTotal);
    cartLink.setAttribute(
      "aria-label",
      `Shopping cart, ${quantityTotal} ${quantityTotal === 1 ? "item" : "items"}`,
    );
    cartItemCount.textContent = `${quantityTotal} ${quantityTotal === 1 ? "item" : "items"}`;
    cartTotal.textContent = formatPrice(priceTotal);
    cartCheckout.disabled = quantityTotal === 0;
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const addButton = event.target.closest("[data-add-to-cart]");
    if (addButton instanceof HTMLButtonElement) {
      const card = addButton.closest(".product-card");
      const productId = addButton.dataset.productId;
      const name = card?.querySelector("h3")?.textContent?.trim();
      const price = Number(card?.dataset.price);

      if (!productId || !name || !Number.isFinite(price) || price <= 0) {
        cartStatus.textContent = "This item could not be added. Please refresh and try again.";
        return;
      }

      const existingItem = cart.get(productId);
      cart.set(productId, {
        name,
        price,
        quantity: (existingItem?.quantity ?? 0) + 1,
      });
      renderCart();
      cartStatus.textContent = `${name} added to your cart.`;
      return;
    }

    const control = event.target.closest("[data-cart-action]");
    if (!(control instanceof HTMLButtonElement)) {
      return;
    }

    const productId = control.dataset.productId;
    const action = control.dataset.cartAction;
    const item = productId ? cart.get(productId) : undefined;

    if (!productId || !item) {
      cartStatus.textContent = "That cart item is no longer available. Please refresh and try again.";
      return;
    }

    if (action === "increase") {
      item.quantity += 1;
    } else if (action === "decrease") {
      item.quantity -= 1;
      if (item.quantity <= 0) {
        cart.delete(productId);
      }
    } else if (action === "remove") {
      cart.delete(productId);
    }

    renderCart();
    cartStatus.textContent = `${item.name} ${cart.has(productId) ? "updated" : "removed"} from your cart.`;
  });

  cartCheckout.addEventListener("click", () => {
    if (cart.size === 0) {
      cartStatus.textContent = "Add an item to your cart before placing an order.";
      return;
    }

    const orderLines = Array.from(cart.values(), (item) =>
      `${item.quantity} × ${item.name} — ${formatPrice(item.price * item.quantity)}`);
    const total = Array.from(cart.values()).reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const message = `Hi DRACOWORLD, I would like to order:\n${orderLines.join("\n")}\n\nTotal: ${formatPrice(total)}`;
    openWhatsApp(message, cartStatus);
  });

  renderCart();
}

const contactForm = document.querySelector("#contact-form");
const contactName = document.querySelector("#contact-name");
const contactMessage = document.querySelector("#contact-message");
const contactStatus = document.querySelector("#contact-status");

if (contactForm && contactName && contactMessage && contactStatus) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!contactForm.reportValidity()) {
      return;
    }

    const message = `Hi DRACOWORLD, my name is ${contactName.value.trim()}.\n\n${contactMessage.value.trim()}`;
    openWhatsApp(message, contactStatus);
  });
}
