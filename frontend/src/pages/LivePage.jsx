import React from "react";
import ScrollToTop from "react-scroll-to-top";
import Preloader from "../helper/Preloader";
import ColorInit from "../helper/ColorInit";
import HeaderTwo from "../components/HeaderTwo";
import Breadcrumb from "../components/Breadcrumb";
import FooterTwo from "../components/FooterTwo";
import BottomFooter from "../components/BottomFooter";
import LiveValkeyDemo from "../components/LiveValkeyDemo";

// Showcase page for Challenge 26: socket.io + Valkey integration.
// Visit /live to see real-time trending, inventory, and cart sync backed by
// the Valkey-powered socket.io adapter.
const LivePage = () => {
  return (
    <>
      <ColorInit color={true} />
      <ScrollToTop smooth color="#FA6400" />
      <Preloader />
      <HeaderTwo category={true} />
      <Breadcrumb title={"Live (socket.io + Valkey)"} />
      <LiveValkeyDemo />
      <FooterTwo />
      <BottomFooter />
    </>
  );
};

export default LivePage;
