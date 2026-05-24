import React from "react";
import Preloader from "../helper/Preloader";
import ColorInit from "../helper/ColorInit";
import HeaderTwo from "../components/HeaderTwo";
import Breadcrumb from "../components/Breadcrumb";
import FooterTwo from "../components/FooterTwo";
import BottomFooter from "../components/BottomFooter";
import ShippingOne from "../components/ShippingOne";
import Recommendations from "../components/Recommendations";
import ScrollToTop from "react-scroll-to-top";

const RecommendationsPage = () => {
  return (
    <>
      <ColorInit color={true} />
      <ScrollToTop smooth color="#FA6400" />
      <Preloader />
      <HeaderTwo category={true} />
      <Breadcrumb title={"Recommended For You"} />
      <Recommendations />
      <ShippingOne />
      <FooterTwo />
      <BottomFooter />
    </>
  );
};

export default RecommendationsPage;
