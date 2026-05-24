import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ValkeyChallengeNav from "./ValkeyChallengeNav";
import { useCart } from "../context/CartContext";
import { getProducts } from "../services/valkeyApi";

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const CartSection = () => {
  const { items, totals, updateQuantity, removeItem, clearCart, loadDemoCart } = useCart();
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getProducts()
      .then((data) => setProducts(data.products || []))
      .catch((error) => setMessage(error.message));
  }, []);

  return (
    <>
      <ValkeyChallengeNav />
      <section className="cart py-60">
        <div className="container container-lg">
          {message && <div className="alert alert-warning rounded-8">{message}</div>}
          <div className="row gy-4">
            <div className="col-xl-9 col-lg-8">
              <div className="cart-table border border-gray-100 rounded-8 px-24 py-32">
                <div className="flex-between flex-wrap gap-16 mb-24">
                  <div>
                    <span className="text-sm text-main-600 fw-semibold">Challenge 10</span>
                    <h6 className="mb-0 mt-4">Inventory-backed cart</h6>
                  </div>
                  <div className="d-flex gap-8 flex-wrap">
                    <button className="btn bg-gray-50 text-heading py-10 px-14 rounded-8 hover-bg-main-600 hover-text-white flex-align gap-8" type="button" onClick={() => loadDemoCart(products)} disabled={products.length === 0}>
                      <i className="ph ph-package" />
                      Load demo cart
                    </button>
                    <Link to="/semantic-search" className="btn btn-main py-10 px-14 rounded-8 flex-align gap-8">
                      <i className="ph ph-magnifying-glass" />
                      Add products
                    </Link>
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="text-center py-60">
                    <i className="ph ph-shopping-cart text-4xl text-gray-400" />
                    <h6 className="mt-16 mb-8">Cart is empty</h6>
                    <p className="text-gray-600 mb-24">Use semantic search or load demo items to start the checkout flow.</p>
                    <Link to="/semantic-search" className="btn btn-main py-12 px-20 rounded-8">
                      Search products
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto scroll-sm scroll-sm-horizontal">
                      <table className="table style-three">
                        <thead>
                          <tr>
                            <th className="h6 mb-0 text-lg fw-bold">Product</th>
                            <th className="h6 mb-0 text-lg fw-bold">Price</th>
                            <th className="h6 mb-0 text-lg fw-bold">Quantity</th>
                            <th className="h6 mb-0 text-lg fw-bold">Subtotal</th>
                            <th className="h6 mb-0 text-lg fw-bold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => {
                            const available = item.product.inventory.quantity - item.product.inventory.reserved;
                            return (
                              <tr key={item.productId}>
                                <td>
                                  <div className="table-product d-flex align-items-center gap-20">
                                    <div className="table-product__thumb border border-gray-100 rounded-8 flex-center">
                                      <img src={item.product.images?.[0]?.url || "/assets/images/thumbs/product-img1.png"} alt={item.product.name} />
                                    </div>
                                    <div className="table-product__content text-start">
                                      <h6 className="title text-lg fw-semibold mb-8">{item.product.name}</h6>
                                      <span className="text-sm text-gray-600">{available} available, {item.product.inventory.reserved} reserved</span>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span className="text-lg h6 mb-0 fw-semibold">{currency.format(item.product.price.amount)}</span>
                                </td>
                                <td>
                                  <div className="d-flex align-items-center gap-8">
                                    <button className="btn bg-gray-50 py-8 px-10 rounded-8" type="button" onClick={() => updateQuantity(item.productId, item.quantity - 1)} aria-label="Decrease quantity">
                                      <i className="ph ph-minus" />
                                    </button>
                                    <input
                                      className="common-input border-gray-100 text-center"
                                      style={{ width: 76 }}
                                      value={item.quantity}
                                      onChange={(event) => updateQuantity(item.productId, event.target.value)}
                                    />
                                    <button className="btn bg-gray-50 py-8 px-10 rounded-8" type="button" onClick={() => updateQuantity(item.productId, item.quantity + 1)} aria-label="Increase quantity">
                                      <i className="ph ph-plus" />
                                    </button>
                                  </div>
                                </td>
                                <td>
                                  <span className="text-lg h6 mb-0 fw-semibold">{currency.format(item.product.price.amount * item.quantity)}</span>
                                </td>
                                <td>
                                  <button className="remove-tr-btn flex-align gap-8 hover-text-danger-600" type="button" onClick={() => removeItem(item.productId)}>
                                    <i className="ph ph-x-circle text-2xl d-flex" />
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex-between flex-wrap gap-16 mt-16">
                      <button className="text-lg text-gray-500 hover-text-main-600" type="button" onClick={clearCart}>
                        Clear cart
                      </button>
                      <Link to="/checkout" className="btn btn-main py-14 px-20 rounded-8 flex-align gap-8">
                        <i className="ph ph-credit-card" />
                        Proceed to checkout
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="col-xl-3 col-lg-4">
              <div className="cart-sidebar border border-gray-100 rounded-8 px-24 py-32">
                <h6 className="text-xl mb-24">Cart Totals</h6>
                <div className="bg-color-three rounded-8 p-24">
                  <div className="mb-24 flex-between gap-8">
                    <span className="text-gray-900 font-heading-two">Items</span>
                    <span className="text-gray-900 fw-semibold">{totals.count}</span>
                  </div>
                  <div className="mb-24 flex-between gap-8">
                    <span className="text-gray-900 font-heading-two">Subtotal</span>
                    <span className="text-gray-900 fw-semibold">{currency.format(totals.subtotal)}</span>
                  </div>
                  <div className="mb-0 flex-between gap-8">
                    <span className="text-gray-900 font-heading-two">Reserved after checkout start</span>
                    <span className="text-gray-900 fw-semibold">Valkey Lua</span>
                  </div>
                </div>
                <div className="bg-color-three rounded-8 p-24 mt-24">
                  <div className="flex-between gap-8">
                    <span className="text-gray-900 text-xl fw-semibold">Total</span>
                    <span className="text-gray-900 text-xl fw-semibold">{currency.format(totals.total)}</span>
                  </div>
                </div>
                <Link to={items.length > 0 ? "/checkout" : "/semantic-search"} className="btn btn-main mt-32 py-16 w-100 rounded-8">
                  {items.length > 0 ? "Checkout" : "Find products"}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default CartSection;
